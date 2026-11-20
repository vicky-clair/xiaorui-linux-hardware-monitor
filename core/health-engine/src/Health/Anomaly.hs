{-# LANGUAGE OverloadedStrings #-}

module Health.Anomaly
  ( detectAnomalies
  ) where

import Data.List (sort)
import Data.Maybe (mapMaybe)
import qualified Data.Text as T
import Health.Protocol (AnomalyRecord (..), HistoryPoint (..), ReadingQuality (..))

-- | Pure anomaly detection over valid history points:
--   1. Robust MAD (Median Absolute Deviation) modified Z-score >= 3.5 with delta >= 6.0
--      (resistant to single prior outliers contaminating mean/std).
--   2. Classic Z-score fallback (|z| >= 3.0 and delta >= 8.0) when baseline MAD is 0.
--   3. Sudden single-step jump (|latest - previous| >= 12.0) to catch abrupt cooling failure.
detectAnomalies :: [HistoryPoint] -> [AnomalyRecord]
detectAnomalies pts =
  let vals = mapMaybe validVal pts
   in case reverse vals of
        (latest : prev@(prevLast : _ : _ : _)) ->
          let med = median prev
              absDevs = map (\v -> abs (v - med)) prev
              mad = median absDevs
              madDelta = abs (latest - med)
              stepDelta = abs (latest - prevLast)
              n = fromIntegral (length prev) :: Double
              mean = sum prev / n
              std = sqrt (sum (map (\v -> (v - mean) ^ (2 :: Int)) prev) / n)
              meanDelta = abs (latest - mean)
              robustRecord
                | mad > 0.01 && madDelta >= 6.0 && (0.6745 * madDelta / mad) >= 3.5 =
                    [ AnomalyRecord
                        { anomalyRecCode = "ROBUST_MAD_SPIKE"
                        , anomalyRecReason =
                            "Latest value "
                              <> fmt1 latest
                              <> " deviates sharply from robust median "
                              <> fmt1 med
                              <> " (MAD="
                              <> fmt1 mad
                              <> ")"
                        }
                    ]
                | std > 0.01 && meanDelta >= 8.0 && (meanDelta / std) >= 3.0 =
                    [ AnomalyRecord
                        { anomalyRecCode = "STATISTICAL_SPIKE"
                        , anomalyRecReason =
                            "Latest value "
                              <> fmt1 latest
                              <> " deviates from baseline mean "
                              <> fmt1 mean
                        }
                    ]
                | otherwise = []
              stepRecord
                | stepDelta >= 12.0 =
                    [ AnomalyRecord
                        { anomalyRecCode = "SUDDEN_STEP_CHANGE"
                        , anomalyRecReason =
                            "Abrupt single-interval jump of "
                              <> fmt1 stepDelta
                              <> " (from "
                              <> fmt1 prevLast
                              <> " to "
                              <> fmt1 latest
                              <> ")"
                        }
                    ]
                | otherwise = []
           in robustRecord <> stepRecord
        _ -> []
  where
    validVal hp
      | hpQuality hp == QualityValid = hpValue hp
      | otherwise = Nothing

    fmt1 :: Double -> T.Text
    fmt1 x = T.pack (show (fromIntegral (round (x * 10) :: Int) / 10.0 :: Double))

    median :: [Double] -> Double
    median [] = 0
    median xs =
      let s = sort xs
          len = length s
          mid = len `div` 2
       in if odd len
            then s !! mid
            else ((s !! (mid - 1)) + (s !! mid)) / 2.0
