module Health.Anomaly
  ( AnomalyFlag (..)
  ) where

import Data.Text (Text)

data AnomalyFlag = AnomalyFlag
  { anomalyCode :: Text
  , anomalyReason :: Text
  }
  deriving (Eq, Show)
