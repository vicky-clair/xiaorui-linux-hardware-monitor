{-# LANGUAGE OverloadedStrings #-}

module Health.Correlation
  ( detectCorrelations
  ) where

import Data.Maybe (mapMaybe)
import Health.Protocol
  ( CorrelationRecord (..)
  , ReadingQuality (..)
  , SensorReading (..)
  , TrendDirection (..)
  )

-- | Multi-metric correlation checks (e.g., high temperature with stopped 0 RPM fan).
detectCorrelations :: [SensorReading] -> TrendDirection -> [CorrelationRecord]
detectCorrelations readings trend =
  let validTemps =
        mapMaybe
          ( \r ->
              if readingQuality r == QualityValid && readingMetric r == "temperature"
                then readingValue r
                else Nothing
          )
          readings
      validFans =
        mapMaybe
          ( \r ->
              if readingQuality r == QualityValid && readingMetric r == "fan_speed"
                then readingValue r
                else Nothing
          )
          readings
      maxTemp = if null validTemps then Nothing else Just (maximum validTemps)
      hasStoppedFan = any (<= 0.0) validFans
      c1 = case maxTemp of
        Just t | t >= 75.0 && hasStoppedFan ->
          [ CorrelationRecord
              { corrRecCode = "THERMAL_WITH_STOPPED_FAN"
              , corrRecSummary = "High temperature detected while a fan reports 0 RPM"
              }
          ]
        _ -> []
      c2 = case maxTemp of
        Just t | t >= 75.0 && trend == TrendRising ->
          [ CorrelationRecord
              { corrRecCode = "SUSTAINED_THERMAL_RISE"
              , corrRecSummary = "Temperature is elevated and continuing to rise"
              }
          ]
        _ -> []
   in c1 <> c2
