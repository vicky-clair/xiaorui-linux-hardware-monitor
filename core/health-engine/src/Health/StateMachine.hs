{-# LANGUAGE OverloadedStrings #-}

-- | 确定性纯函数告警状态机（ADR-0007）：
-- 状态流转：Ok -> Pending（满足阈值且持续时间 > 0）-> Firing（达到持续时长）-> Resolved（恢复并满足 5% 滞回防抖边界）。
-- 缺失/过期/故障采样不会误触发新告警，也不会误解除已激活告警。
module Health.StateMachine
  ( stepAlertState
  , parseIsoUtc
  ) where

import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import Data.Time (UTCTime, diffUTCTime)
import Data.Time.Format.ISO8601 (iso8601ParseM)
import Health.Protocol
  ( AlertRuleSpec (..)
  , AlertStateName (..)
  , AlertStateSnapshot (..)
  , AlertTransitionKind (..)
  , AlertTransitionRecord (..)
  , ThresholdSource (..)
  )
import Health.Rules (evaluateOperator, evaluateWithHysteresis)

parseIsoUtc :: T.Text -> Maybe UTCTime
parseIsoUtc = iso8601ParseM . T.unpack

secondsSince :: T.Text -> T.Text -> Double
secondsSince startIso endIso =
  fromMaybe 0.0 $ do
    t0 <- parseIsoUtc startIso
    t1 <- parseIsoUtc endIso
    pure (realToFrac (diffUTCTime t1 t0))

-- | Pure deterministic alert state machine (ADR-0007):
-- Ok -> Pending (when breached & duration > 0) -> Firing (once duration elapsed)
-- Firing -> Resolved (only once value clears threshold with 5% hysteresis margin)
stepAlertState ::
  T.Text ->
  T.Text ->
  T.Text ->
  AlertRuleSpec ->
  ThresholdSource ->
  Maybe Double ->
  Maybe AlertStateSnapshot ->
  (AlertStateSnapshot, Maybe AlertTransitionRecord)
stepAlertState hostId deviceId nowIso rule thSrc mVal mPrev =
  let stateKey = hostId <> ":" <> deviceId <> ":" <> ruleSpecId rule
      prevState = maybe AlertStateOk snapState mPrev
      prevPending = mPrev >>= snapPendingSince
      prevFiring = mPrev >>= snapFiringSince
      th = ruleSpecThreshold rule
      dur = fromIntegral (ruleSpecDurationSeconds rule) :: Double
      makeSnap st pSince fSince =
        AlertStateSnapshot
          { snapStateKey = stateKey
          , snapHostId = hostId
          , snapDeviceId = deviceId
          , snapRuleId = ruleSpecId rule
          , snapState = st
          , snapPendingSince = pSince
          , snapFiringSince = fSince
          , snapLastEvaluatedAt = nowIso
          }
      makeTrans kind summary =
        AlertTransitionRecord
          { transStateKey = stateKey
          , transHostId = hostId
          , transDeviceId = deviceId
          , transRuleId = ruleSpecId rule
          , transKind = kind
          , transSeverity = ruleSpecSeverity rule
          , transSummary = summary
          , transMetric = ruleSpecMetric rule
          , transObservedValue = mVal
          , transThreshold = th
          , transThresholdSource = thSrc
          }
   in case mVal of
        -- Missing/stale/faulty value: never falsely resolve an active firing alert and never fire
        Nothing ->
          (makeSnap prevState prevPending prevFiring, Nothing)
        Just val ->
          let breached = evaluateOperator (ruleSpecOperator rule) val th
              cleared = evaluateWithHysteresis (ruleSpecOperator rule) val th
           in case prevState of
                AlertStateOk ->
                  if breached
                    then
                      if dur <= 0
                        then
                          ( makeSnap AlertStateFiring (Just nowIso) (Just nowIso)
                          , Just $
                              makeTrans
                                TransitionTrigger
                                (ruleSpecMetric rule <> " reached " <> T.pack (show val) <> " (threshold " <> T.pack (show th) <> ")")
                          )
                        else (makeSnap AlertStatePending (Just nowIso) Nothing, Nothing)
                    else (makeSnap AlertStateOk Nothing Nothing, Nothing)
                AlertStateResolved ->
                  if breached
                    then
                      if dur <= 0
                        then
                          ( makeSnap AlertStateFiring (Just nowIso) (Just nowIso)
                          , Just $
                              makeTrans
                                TransitionTrigger
                                (ruleSpecMetric rule <> " re-triggered at " <> T.pack (show val))
                          )
                        else (makeSnap AlertStatePending (Just nowIso) Nothing, Nothing)
                    else (makeSnap AlertStateOk Nothing Nothing, Nothing)
                AlertStatePending ->
                  if breached
                    then
                      let since = fromMaybe nowIso prevPending
                       in if secondsSince since nowIso >= dur
                            then
                              ( makeSnap AlertStateFiring (Just since) (Just nowIso)
                              , Just $
                                  makeTrans
                                    TransitionTrigger
                                    (ruleSpecMetric rule <> " sustained at " <> T.pack (show val) <> " for >= " <> T.pack (show (ruleSpecDurationSeconds rule)) <> "s")
                              )
                            else (makeSnap AlertStatePending (Just since) Nothing, Nothing)
                    else (makeSnap AlertStateOk Nothing Nothing, Nothing)
                AlertStateFiring ->
                  if cleared
                    then
                      ( makeSnap AlertStateResolved Nothing Nothing
                      , Just $
                          makeTrans
                            TransitionResolve
                            (ruleSpecMetric rule <> " recovered to " <> T.pack (show val))
                      )
                    else (makeSnap AlertStateFiring prevPending (Just (fromMaybe nowIso prevFiring)), Nothing)
