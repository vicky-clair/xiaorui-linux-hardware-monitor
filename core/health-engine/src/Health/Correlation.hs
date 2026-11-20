module Health.Correlation
  ( CorrelationFinding (..)
  ) where

import Data.Text (Text)

data CorrelationFinding = CorrelationFinding
  { correlationCode :: Text
  , correlationSummary :: Text
  }
  deriving (Eq, Show)
