module Health.Trends
  ( TrendDirection (..)
  ) where

data TrendDirection
  = Rising
  | Stable
  | Falling
  | InsufficientData
  deriving (Eq, Show)
