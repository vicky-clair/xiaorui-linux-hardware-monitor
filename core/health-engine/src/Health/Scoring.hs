module Health.Scoring
  ( ScoreFactor (..)
  , HealthScore (..)
  ) where

import Data.Text (Text)

data ScoreFactor = ScoreFactor
  { factorMetric :: Text
  , factorDelta :: Double
  , factorReason :: Text
  }
  deriving (Eq, Show)

data HealthScore = HealthScore
  { scoreValue :: Maybe Double
  , scoreEngineVersion :: Text
  , scoreFactors :: [ScoreFactor]
  }
  deriving (Eq, Show)
