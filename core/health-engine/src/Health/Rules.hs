module Health.Rules
  ( RuleOperator (..)
  , Rule (..)
  ) where

import Data.Text (Text)
import Health.Protocol (DeviceType, Severity, Unit)

data RuleOperator
  = OpGt
  | OpGte
  | OpLt
  | OpLte
  deriving (Eq, Show)

data Rule = Rule
  { ruleId :: Text
  , ruleMetric :: Text
  , ruleDeviceType :: DeviceType
  , ruleOperator :: RuleOperator
  , ruleThreshold :: Double
  , ruleUnit :: Unit
  , ruleDurationSeconds :: Int
  , ruleSeverity :: Severity
  , ruleEnabled :: Bool
  }
  deriving (Eq, Show)
