{-# LANGUAGE OverloadedStrings #-}

-- | Haskell 健康分析引擎无状态 HTTP/1.1 服务入口（ADR-0004）。
-- 仅暴露内部接口：
--   - GET  /health     ：容器健康检查与协议/引擎版本
--   - POST /v1/analyze ：接收单次分析请求并返回纯计算结果与告警状态转移
-- 严格遵守职责边界：不访问 SQLite、不读取 /sys 或 /proc、单次请求体硬上限 4 MiB。
module Main (main) where

import Control.Concurrent (forkIO)
import Control.Exception (SomeException, bracket, catch, finally)
import Control.Monad (forever, void)
import Data.Aeson (ToJSON, eitherDecode, encode, object, (.=))
import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as BSC
import qualified Data.ByteString.Lazy as LBS
import Data.Char (toLower)
import Data.Maybe (fromMaybe)
import Health.Engine (analyze)
import Health.Protocol (AnalyzeRequest)
import Health.Types (EngineInfo (..), engineInfo)
import Network.Socket
  ( AddrInfo (..)
  , AddrInfoFlag (AI_PASSIVE)
  , Socket
  , SocketOption (ReuseAddr)
  , SocketType (Stream)
  , accept
  , bind
  , close
  , defaultHints
  , getAddrInfo
  , listen
  , openSocket
  , setSocketOption
  , withSocketsDo
  )
import Network.Socket.ByteString (recv, sendAll)
import System.Environment (lookupEnv)
import System.IO (hFlush, stderr)
import Text.Read (readMaybe)

maxBodyBytes :: Int
maxBodyBytes = 4 * 1024 * 1024 -- 4 MiB hard cap

main :: IO ()
main = withSocketsDo $ do
  bindHost <- fromMaybe "127.0.0.1" <$> lookupEnv "LHM_HEALTH_BIND"
  portStr <- fromMaybe "8090" <$> lookupEnv "LHM_HEALTH_PORT"
  let hints = defaultHints {addrFlags = [AI_PASSIVE], addrSocketType = Stream}
  addrs <- getAddrInfo (Just hints) (Just bindHost) (Just portStr)
  addr <- case addrs of
    (a : _) -> pure a
    [] -> fail $ "Could not resolve bind address: " <> bindHost <> ":" <> portStr

  bracket (openSocket addr) close $ \sock -> do
    setSocketOption sock ReuseAddr 1
    bind sock (addrAddress addr)
    listen sock 64
    let info = engineInfo
    BSC.hPutStrLn stderr $
      LBS.toStrict $
        encode $
          object
            [ "component" .= ("lhm-health-engine" :: String)
            , "level" .= ("INFO" :: String)
            , "engine_version" .= engineVersion info
            , "protocol_schema_version" .= engineProtocolVersion info
            , "message" .= ("Listening on http://" <> bindHost <> ":" <> portStr)
            ]
    hFlush stderr
    forever $ do
      (conn, _) <- accept sock
      void $ forkIO (handleClient conn `finally` close conn)

handleClient :: Socket -> IO ()
handleClient conn =
  ( do
      rawHead <- readUntilHeaderEnd conn BS.empty
      case rawHead of
        Nothing -> pure ()
        Just (headerBytes, rest) -> do
          let headerLines = BSC.lines (BSC.filter (/= '\r') headerBytes)
          case headerLines of
            [] -> sendJson conn 400 "Bad Request" (object ["error" .= ("EMPTY_REQUEST" :: String)])
            (reqLine : hdrs) -> do
              let parts = BSC.words reqLine
              case parts of
                (method : path : _) -> do
                  let contentLen = fromMaybe 0 (parseContentLength hdrs)
                  if contentLen < 0 || contentLen > maxBodyBytes
                    then
                      sendJson
                        conn
                        413
                        "Payload Too Large"
                        (object ["error" .= ("PAYLOAD_TOO_LARGE" :: String)])
                    else do
                      body <- readExact conn rest contentLen
                      routeRequest conn method path body
                _ ->
                  sendJson conn 400 "Bad Request" (object ["error" .= ("MALFORMED_REQUEST_LINE" :: String)])
  )
    `catch` (\(_ :: SomeException) -> pure ())

routeRequest :: Socket -> BS.ByteString -> BS.ByteString -> BS.ByteString -> IO ()
routeRequest conn method path body
  | method == "GET" && path == "/health" =
      let info = engineInfo
       in sendJson
            conn
            200
            "OK"
            ( object
                [ "status" .= ("ok" :: String)
                , "service" .= ("lhm-health-engine" :: String)
                , "engine_version" .= engineVersion info
                , "protocol_schema_version" .= engineProtocolVersion info
                ]
            )
  | method == "POST" && path == "/v1/analyze" =
      case eitherDecode (LBS.fromStrict body) :: Either String AnalyzeRequest of
        Left err ->
          sendJson
            conn
            400
            "Bad Request"
            (object ["error" .= ("INVALID_ANALYZE_REQUEST" :: String), "message" .= err])
        Right req ->
          let resp = analyze req
           in sendJson conn 200 "OK" resp
  | otherwise =
      sendJson conn 404 "Not Found" (object ["error" .= ("NOT_FOUND" :: String)])

readUntilHeaderEnd :: Socket -> BS.ByteString -> IO (Maybe (BS.ByteString, BS.ByteString))
readUntilHeaderEnd conn acc
  | BS.length acc > 65536 = pure Nothing
  | otherwise =
      let (before, after) = BS.breakSubstring "\r\n\r\n" acc
       in if not (BS.null after)
            then pure (Just (before, BS.drop 4 after))
            else do
              chunk <- recv conn 4096
              if BS.null chunk
                then pure Nothing
                else readUntilHeaderEnd conn (acc <> chunk)

readExact :: Socket -> BS.ByteString -> Int -> IO BS.ByteString
readExact conn acc needed
  | BS.length acc >= needed = pure (BS.take needed acc)
  | otherwise = do
      chunk <- recv conn (min 16384 (needed - BS.length acc))
      if BS.null chunk
        then pure acc
        else readExact conn (acc <> chunk) needed

parseContentLength :: [BS.ByteString] -> Maybe Int
parseContentLength [] = Nothing
parseContentLength (h : hs) =
  let (k, v) = BSC.break (== ':') h
      keyLower = map toLower (BSC.unpack (BSC.strip k))
   in if keyLower == "content-length"
        then readMaybe (BSC.unpack (BSC.strip (BS.drop 1 v)))
        else parseContentLength hs

sendJson :: (ToJSON a) => Socket -> Int -> BS.ByteString -> a -> IO ()
sendJson conn status reason payload = do
  let body = LBS.toStrict (encode payload)
      header =
        "HTTP/1.1 "
          <> BSC.pack (show status)
          <> " "
          <> reason
          <> "\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: "
          <> BSC.pack (show (BS.length body))
          <> "\r\nConnection: close\r\n\r\n"
  sendAll conn (header <> body)
