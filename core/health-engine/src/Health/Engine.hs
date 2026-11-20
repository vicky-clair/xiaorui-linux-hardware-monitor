{-# LANGUAGE OverloadedStrings #-}

-- | 健康分析顶层纯函数编排模块（ADR-0004 / ADR-0007）。
-- 串联趋势分析（Trends）、异常检测（Anomaly）、多指标关联（Correlation）、
-- 阈值解析（Thresholds）、告警状态机（StateMachine）与可解释评分（Scoring）。
module Health.Engine
  ( evaluateReadingQuality
  , analyze
  ) where

import qualified Data.Map.Strict as M
import Data.Maybe (catMaybes)
import qualified Data.Text as T
import Health.Anomaly (detectAnomalies)
import Health.Correlation (detectCorrelations)
import Health.Protocol
import Health.Rules (evaluateOperator, ruleAppliesTo)
import Health.Scoring (scoreDevice)
import Health.StateMachine (stepAlertState)
import Health.Thresholds (ResolvedThreshold (..), resolveThreshold)
import Health.Trends (computeTrend)
import Health.Types (EngineInfo (..), engineInfo)

-- | Basic reading quality invariant: stale/missing/faulty readings never evaluate to Normal.
evaluateReadingQuality :: SensorReading -> Severity
evaluateReadingQuality r = case readingQuality r of
  QualityValid -> SeverityNormal
  QualityStale -> SeverityUnknown
  QualityMissing -> SeverityUnknown
  QualitySensorFault -> SeverityUnknown
  QualityOutOfRange -> SeverityWarning

-- | Pure top-level health analysis entrypoint (ADR-0004, ADR-0007).
analyze :: AnalyzeRequest -> AnalyzeResponse
analyze req =
  let hostId = reqHostId req
      nowIso = reqEvaluatedAt req
      ruleVer = reqRuleVersion req
      prevStateMap = M.fromList [(snapStateKey s, s) | s <- reqPrevAlertStates req]

      evalDevice dev =
        let devId = refDeviceId dev
            devReadings = filter (\r -> readingDeviceId r == devId) (reqReadings req)
            devHistory = filter (\h -> hpDeviceId h == devId) (reqHistoryPoints req)
            tempHistory = filter (\h -> hpMetric h == "temperature") devHistory
            trend = computeTrend (if null tempHistory then devHistory else tempHistory)
            anomalies = detectAnomalies (if null tempHistory then devHistory else tempHistory)
            correlations = detectCorrelations devReadings trend
            applicableRules = filter (`ruleAppliesTo` dev) (reqRules req)

            evalRule rule =
              let matching =
                    [ r
                    | r <- devReadings
                    , readingMetric r == ruleSpecMetric rule
                    , readingQuality r == QualityValid
                    ]
                  observed = case [v | r <- matching, Just v <- [readingValue r]] of
                    [] -> Nothing
                    vs -> Just (maximum vs)
                  resolved =
                    resolveThreshold
                      (refDeviceType dev)
                      devId
                      (ruleSpecMetric rule)
                      (Just rule)
                      (reqHardwareLimits req)
                  stateKey = hostId <> ":" <> devId <> ":" <> ruleSpecId rule
                  prevSnap = M.lookup stateKey prevStateMap
                  (nextSnap, mTrans) =
                    stepAlertState
                      hostId
                      devId
                      nowIso
                      rule
                      (resolvedSource resolved)
                      observed
                      prevSnap
                  penalty = case observed of
                    Just v
                      | evaluateOperator (ruleSpecOperator rule) v (ruleSpecThreshold rule) ->
                          let delta = case ruleSpecSeverity rule of
                                SeverityCritical -> -40.0
                                SeverityWarning -> -20.0
                                _ -> -5.0
                           in Just
                                ( ruleSpecSeverity rule
                                , ScoreFactorRecord
                                    { factorRecMetric = ruleSpecMetric rule
                                    , factorRecDelta = delta
                                    , factorRecReason =
                                        "Rule "
                                          <> ruleSpecId rule
                                          <> " exceeded ("
                                          <> T.pack (show v)
                                          <> " vs "
                                          <> T.pack (show (ruleSpecThreshold rule))
                                          <> "; "
                                          <> resolvedNote resolved
                                          <> ")"
                                    }
                                )
                    _ -> Nothing
               in (resolvedSource resolved, nextSnap, mTrans, penalty)

            ruleOutputs = map evalRule applicableRules
            primaryThSrc = case ruleOutputs of
              ((src, _, _, _) : _) -> src
              [] ->
                resolvedSource $
                  resolveThreshold (refDeviceType dev) devId "temperature" Nothing (reqHardwareLimits req)
            nextSnaps = [sn | (_, sn, _, _) <- ruleOutputs]
            transitions = catMaybes [mt | (_, _, mt, _) <- ruleOutputs]
            penalties = catMaybes [mp | (_, _, _, mp) <- ruleOutputs]
            analysis =
              scoreDevice
                hostId
                ruleVer
                nowIso
                dev
                devReadings
                primaryThSrc
                trend
                anomalies
                correlations
                penalties
         in (analysis, transitions, nextSnaps)

      perDevice = map evalDevice (reqDevices req)
   in AnalyzeResponse
        { respSchemaVersion = engineProtocolVersion engineInfo
        , respEngineVersion = engineVersion engineInfo
        , respRuleVersion = ruleVer
        , respAnalyzedAt = nowIso
        , respAnalysisResults = [a | (a, _, _) <- perDevice]
        , respAlertTransitions = concat [ts | (_, ts, _) <- perDevice]
        , respNextAlertStates = concat [ss | (_, _, ss) <- perDevice]
        }
