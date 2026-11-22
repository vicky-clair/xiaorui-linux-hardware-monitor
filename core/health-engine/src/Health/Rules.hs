-- | 告警阈值比较与 5% 滞回防抖规则求值模块（纯函数），避免传感器在临界值附近抖动引发告警风暴。
module Health.Rules
  ( evaluateOperator
  , evaluateWithHysteresis
  , ruleAppliesTo
  ) where

import Health.Protocol
  ( AlertRuleSpec (..)
  , AnalyzeDeviceRef (..)
  , RuleOperator (..)
  )

evaluateOperator :: RuleOperator -> Double -> Double -> Bool
evaluateOperator OpGt val th = val > th
evaluateOperator OpGte val th = val >= th
evaluateOperator OpLt val th = val < th
evaluateOperator OpLte val th = val <= th

-- | Applies a 5% hysteresis margin to avoid alert flapping near the threshold boundary.
evaluateWithHysteresis :: RuleOperator -> Double -> Double -> Bool
evaluateWithHysteresis op val th =
  let margin = max 0.5 (abs th * 0.05)
   in case op of
        OpGt -> val <= th - margin
        OpGte -> val < th - margin
        OpLt -> val >= th + margin
        OpLte -> val > th + margin

ruleAppliesTo :: AlertRuleSpec -> AnalyzeDeviceRef -> Bool
ruleAppliesTo rule dev =
  ruleSpecEnabled rule
    && ruleSpecDeviceType rule == refDeviceType dev
    && case ruleSpecDeviceId rule of
      Nothing -> True
      Just target -> target == refDeviceId dev
