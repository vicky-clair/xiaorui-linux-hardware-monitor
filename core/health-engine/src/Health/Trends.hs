module Health.Trends
  ( computeTrend
  ) where

import Data.Maybe (mapMaybe)
import Health.Protocol (HistoryPoint (..), ReadingQuality (..), TrendDirection (..))

-- | Computes linear trend direction over valid historical values.
-- Requires at least 3 valid points; returns TrendInsufficientData otherwise.
computeTrend :: [HistoryPoint] -> TrendDirection
computeTrend pts =
  let vals = mapMaybe validVal pts
      n = length vals
   in if n < 3
        then TrendInsufficientData
        else
          let xs = [0 .. fromIntegral (n - 1) :: Double]
              meanX = sum xs / fromIntegral n
              meanY = sum vals / fromIntegral n
              num = sum $ zipWith (\x y -> (x - meanX) * (y - meanY)) xs vals
              den = sum $ map (\x -> (x - meanX) ^ (2 :: Int)) xs
              slope = if den == 0 then 0 else num / den
           in if slope > 0.5
                then TrendRising
                else
                  if slope < -0.5
                    then TrendFalling
                    else TrendStable
  where
    validVal hp
      | hpQuality hp == QualityValid = hpValue hp
      | otherwise = Nothing
