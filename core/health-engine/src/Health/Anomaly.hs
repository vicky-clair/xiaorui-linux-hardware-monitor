{-# LANGUAGE OverloadedStrings #-}

module Health.Anomaly
  ( detectAnomalies
  ) where

import Data.Maybe (mapMaybe)
import qualified Data.Text as T
import Health.Protocol (AnomalyRecord (..), HistoryPoint (..), ReadingQuality (..))

-- | Detects sudden statistical spikes (|z| >= 3.0 and absolute jump >= 8.0) on valid history points.
detectAnomalies :: [HistoryPoint] -> [AnomalyRecord]
detectAnomalies pts =
  let vals = mapMaybe validVal pts
   in case reverse vals of
        (latest : prev@(_ : _ : _ : _)) ->
          let n = fromIntegral (length prev) :: Double
              mean = sum prev / n
              var = sum (map (\v -> (v - mean) ^ (2 :: Int)) prev) / n
              std = sqrt var
              delta = abs (latest - mean)
           in if std > 0.01 && delta >= 8.0 && (delta / std) >= 3.0
                then
                  [ AnomalyRecord
                      { anomalyRecCode = "STATISTICAL_SPIKE"
                      , anomalyRecReason =
                          "Latest value "
                            <> T.pack (show latest)
                            <> " deviates from baseline mean "
                            <> T.pack (show (fromIntegral (round (mean * 10) :: Int) / 10.0 :: Double))
                      }
                  ]
                else []
        _ -> []
  where
    validVal hp
      | hpQuality hp == QualityValid = hpValue hp
      | otherwise = Nothing
