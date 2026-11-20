{-# LANGUAGE OverloadedStrings #-}

module Health.Thresholds
  ( ResolvedThreshold (..)
  , resolveThreshold
  , genericDefaultTempLimit
  ) where

import Data.List (find)
import Data.Text (Text)
import Health.Protocol
  ( AlertRuleSpec (..)
  , DeviceType (..)
  , HardwareLimit (..)
  , ThresholdSource (..)
  )

data ResolvedThreshold = ResolvedThreshold
  { resolvedValue :: Maybe Double
  , resolvedSource :: ThresholdSource
  , resolvedNote :: Text
  }
  deriving (Eq, Show)

-- | Documented conservative generic defaults used ONLY when hardware limits and user overrides are absent.
genericDefaultTempLimit :: DeviceType -> Maybe (Double, Text)
genericDefaultTempLimit DevCpu = Just (85.0, "generic-default:cpu-temp-85c")
genericDefaultTempLimit DevGpu = Just (85.0, "generic-default:gpu-temp-85c")
genericDefaultTempLimit DevStorage = Just (60.0, "generic-default:storage-temp-60c")
genericDefaultTempLimit DevMotherboard = Just (75.0, "generic-default:motherboard-temp-75c")
genericDefaultTempLimit _ = Nothing

-- | Resolves threshold according to docs/architecture/health-engine.md §5:
-- 1. User per-device rule override takes precedence (warns if looser than hardware crit).
-- 2. Hardware/driver exposed limit (max/crit).
-- 3. Explicit rule or documented generic default.
-- 4. Unavailable (never silently fabricates a threshold).
resolveThreshold ::
  DeviceType ->
  Text ->
  Text ->
  Maybe AlertRuleSpec ->
  [HardwareLimit] ->
  ResolvedThreshold
resolveThreshold devType devId metric mRule hwLimits =
  let mHw =
        find
          (\h -> hwLimitDeviceId h == devId && hwLimitMetric h == metric)
          hwLimits
      hwRef = mHw >>= (\h -> maybe (hwLimitMaxValue h) Just (hwLimitCritValue h))
   in case mRule of
        Just rule
          | ruleSpecDeviceId rule == Just devId ->
              let note = case hwRef of
                    Just crit
                      | ruleSpecThreshold rule > crit ->
                          "user override exceeds hardware limit"
                    _ -> "user device override"
               in ResolvedThreshold (Just (ruleSpecThreshold rule)) ThUserDeviceOverride note
        _ -> case (mHw, hwRef) of
          (Just hw, Just lim) ->
            ResolvedThreshold (Just lim) ThHardwareLimit (hwLimitSource hw)
          _ -> case mRule of
            Just rule ->
              ResolvedThreshold (Just (ruleSpecThreshold rule)) ThGenericDefault ("rule:" <> ruleSpecId rule)
            Nothing
              | metric == "temperature" ->
                  case genericDefaultTempLimit devType of
                    Just (v, src) -> ResolvedThreshold (Just v) ThGenericDefault src
                    Nothing -> ResolvedThreshold Nothing ThUnavailable "no reliable threshold available"
              | otherwise ->
                  ResolvedThreshold Nothing ThUnavailable "no reliable threshold available"
