{-# LANGUAGE OverloadedStrings #-}

-- | 四级阈值优先级解析模块：
-- 1. 用户单设备自定义规则 > 2. 硬件驱动暴露的 max/crit 限值 > 3. 通用保守默认阈值 > 4. 不可用（绝不凭空编造阈值）。
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
        -- 1. 用户单设备自定义规则：实际参与比较的是规则阈值
        Just rule
          | ruleSpecDeviceId rule == Just devId ->
              let note = case hwRef of
                    Just crit
                      | ruleSpecThreshold rule > crit ->
                          "user override exceeds hardware limit"
                    _ -> "user device override"
               in ResolvedThreshold (Just (ruleSpecThreshold rule)) ThUserDeviceOverride note
        -- 2. 全局显式规则（按 device_type 生效）：保持来源与实际比较阈值一致，避免错标为 hardware_limit
        Just rule ->
          let note = case hwRef of
                Just crit
                  | ruleSpecThreshold rule > crit ->
                      "rule:" <> ruleSpecId rule <> " (exceeds hardware limit)"
                _ -> "rule:" <> ruleSpecId rule
           in ResolvedThreshold (Just (ruleSpecThreshold rule)) ThGenericDefault note
        -- 3. 无用户规则时优先回退硬件驱动暴露的 max/crit 限值，再回退保守通用默认阈值，最后标为不可用
        Nothing -> case (mHw, hwRef) of
          (Just hw, Just lim) ->
            ResolvedThreshold (Just lim) ThHardwareLimit (hwLimitSource hw)
          _
            | metric == "temperature" ->
                case genericDefaultTempLimit devType of
                  Just (v, src) -> ResolvedThreshold (Just v) ThGenericDefault src
                  Nothing -> ResolvedThreshold Nothing ThUnavailable "no reliable threshold available"
            | otherwise ->
                ResolvedThreshold Nothing ThUnavailable "no reliable threshold available"
