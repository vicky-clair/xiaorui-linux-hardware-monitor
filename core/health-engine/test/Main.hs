{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import Control.Monad (unless)
import Health.Engine (evaluateReadingQuality)
import Health.Protocol
import Health.Types (EngineInfo (..), engineInfo)
import System.Exit (exitFailure)

main :: IO ()
main = do
  unless (engineProtocolVersion engineInfo == "1.0") $ do
    putStrLn "FAIL: unexpected protocol version"
    exitFailure

  let staleReading =
        SensorReading
          { readingSchemaVersion = "1.0"
          , readingHostId = "debian-host-01"
          , readingDeviceId = "gpu-pci-0000-01-00-0"
          , readingSensorId = "gpu-pci-0000-01-00-0-temp-edge"
          , readingMetric = "temperature"
          , readingValue = Just 40.0
          , readingUnit = UnitCelsius
          , readingQuality = QualityStale
          , readingSource = "hwmon"
          , readingCollectedAt = "2026-11-20T10:00:00Z"
          }
  unless (evaluateReadingQuality staleReading == SeverityUnknown) $ do
    putStrLn "FAIL: stale reading must not evaluate to Normal"
    exitFailure

  putStrLn "All Haskell health-engine Phase 0 tests passed."
