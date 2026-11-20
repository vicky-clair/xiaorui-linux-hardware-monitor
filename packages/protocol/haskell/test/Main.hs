{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Main (main) where

import Control.Monad (unless)
import Data.Aeson (FromJSON, ToJSON, eitherDecode, encode)
import qualified Data.ByteString.Lazy as LBS
import Data.Proxy (Proxy (..))
import Lhm.Protocol
import System.Directory (doesDirectoryExist)
import System.Exit (exitFailure)
import System.FilePath ((</>))

findExamplesDir :: IO FilePath
findExamplesDir = do
  let candidates =
        [ "../examples"
        , "../../packages/protocol/examples"
        , "packages/protocol/examples"
        ]
  go candidates
  where
    go [] = fail "Could not locate packages/protocol/examples directory"
    go (c : cs) = do
      exists <- doesDirectoryExist c
      if exists then pure c else go cs

assertValid :: (FromJSON a, ToJSON a, Eq a) => Proxy a -> FilePath -> IO a
assertValid _ path = do
  raw <- LBS.readFile path
  case eitherDecode raw of
    Left err -> do
      putStrLn $ "FAIL valid fixture " <> path <> ": " <> err
      exitFailure
    Right val -> do
      let reencoded = encode val
      case eitherDecode reencoded of
        Left err -> do
          putStrLn $ "FAIL roundtrip decode " <> path <> ": " <> err
          exitFailure
        Right val2 -> do
          unless (val == val2) $ do
            putStrLn $ "FAIL roundtrip mismatch " <> path
            exitFailure
          putStrLn $ "PASS valid: " <> path
          pure val

assertInvalid :: forall a. (FromJSON a, Show a) => Proxy a -> FilePath -> IO ()
assertInvalid _ path = do
  raw <- LBS.readFile path
  case eitherDecode raw :: Either String a of
    Left _ -> putStrLn $ "PASS rejected invalid: " <> path
    Right val -> do
      putStrLn $ "FAIL invalid fixture unexpectedly parsed " <> path <> ": " <> show val
      exitFailure

main :: IO ()
main = do
  dir <- findExamplesDir
  _ <- assertValid (Proxy :: Proxy Host) (dir </> "valid" </> "host.json")
  _ <- assertValid (Proxy :: Proxy Device) (dir </> "valid" </> "device.json")
  _ <- assertValid (Proxy :: Proxy Sensor) (dir </> "valid" </> "sensor.json")
  _ <- assertValid (Proxy :: Proxy SensorReading) (dir </> "valid" </> "sensor-reading-valid.json")
  zero <- assertValid (Proxy :: Proxy SensorReading) (dir </> "valid" </> "sensor-reading-zero.json")
  unless (readingValue zero == Just 0.0) $ do
    putStrLn "FAIL: expected 0.0 reading value"
    exitFailure
  missing <- assertValid (Proxy :: Proxy SensorReading) (dir </> "valid" </> "sensor-reading-missing.json")
  unless (readingValue missing == Nothing) $ do
    putStrLn "FAIL: expected Nothing reading value"
    exitFailure
  _ <- assertValid (Proxy :: Proxy CollectorStatus) (dir </> "valid" </> "collector-status.json")
  _ <- assertValid (Proxy :: Proxy Diagnostic) (dir </> "valid" </> "diagnostic.json")
  _ <- assertValid (Proxy :: Proxy SmartReport) (dir </> "valid" </> "smart-report-standby.json")
  nvme <- assertValid (Proxy :: Proxy SmartReport) (dir </> "valid" </> "smart-report-nvme-bigint.json")
  unless (fmap unUintString (smartDataUnitsRead nvme) == Just "340282366920938463463374607431768211455") $ do
    putStrLn "FAIL: 128-bit counter string mismatch"
    exitFailure
  _ <- assertValid (Proxy :: Proxy IpcMessage) (dir </> "valid" </> "ipc-hello.json")
  _ <- assertValid (Proxy :: Proxy IpcMessage) (dir </> "valid" </> "ipc-sensor-readings.json")
  _ <- assertValid (Proxy :: Proxy AnalyzeRequest) (dir </> "valid" </> "analyze-request.json")
  _ <- assertValid (Proxy :: Proxy AnalyzeResponse) (dir </> "valid" </> "analyze-response.json")

  assertInvalid (Proxy :: Proxy SensorReading) (dir </> "invalid" </> "sensor-reading-missing-with-zero.json")
  assertInvalid (Proxy :: Proxy SensorReading) (dir </> "invalid" </> "sensor-reading-valid-with-null.json")
  assertInvalid (Proxy :: Proxy SensorReading) (dir </> "invalid" </> "sensor-reading-bad-quality.json")
  assertInvalid (Proxy :: Proxy SmartReport) (dir </> "invalid" </> "smart-report-non-digit-bigint.json")
  assertInvalid (Proxy :: Proxy IpcMessage) (dir </> "invalid" </> "ipc-wrong-protocol.json")
  putStrLn "All Haskell protocol golden fixture tests passed."
