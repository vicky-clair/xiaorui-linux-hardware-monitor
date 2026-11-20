{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import qualified Data.Text.IO as TIO
import Health.Types (EngineInfo (..), engineInfo)

main :: IO ()
main = do
  let info = engineInfo
  TIO.putStrLn $
    "lhm-health-engine "
      <> engineVersion info
      <> " (protocol schema "
      <> engineProtocolVersion info
      <> ")"
