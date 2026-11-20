module Health.Thresholds
  ( ThresholdSource (..)
  ) where

data ThresholdSource
  = HardwareLimit
  | UserDeviceOverride
  | GenericDefault
  | Unavailable
  deriving (Eq, Show)
