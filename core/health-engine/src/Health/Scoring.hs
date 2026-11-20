{-# LANGUAGE OverloadedStrings #-}

-- | 可解释设备健康评分模块（0..100 或 Nothing）。
-- 核心数据红线：待机硬盘不扣分、数据过期绝不判为 Normal、传感器故障绝不当作硬件损坏、每个扣分项均附带明确依据。
module Health.Scoring
  ( scoreDevice
  ) where

import qualified Data.Text as T
import Health.Protocol
  ( AnalysisResultRecord (..)
  , AnalyzeDeviceRef (..)
  , AnomalyRecord (..)
  , CorrelationRecord (..)
  , DeviceStatus (..)
  , ReadingQuality (..)
  , ScoreFactorRecord (..)
  , SensorReading (..)
  , Severity (..)
  , ThresholdSource (..)
  , TrendDirection (..)
  )
import Health.Types (EngineInfo (..), engineInfo, maxSeverity)

-- | Computes an explainable health score (0..100 or Nothing when data is stale/missing/faulty).
-- Enforces invariants from docs/architecture/health-engine.md §6:
-- - Unsupported/missing metrics do NOT deduct points as hardware failures.
-- - Stale data NEVER evaluates to Normal (outputs SeverityUnknown + score=Nothing).
-- - Sensor fault NEVER equals hardware failure (outputs SeverityUnknown + explanation).
-- - Standby storage devices are reported cleanly without penalty.
scoreDevice ::
  T.Text ->
  T.Text ->
  T.Text ->
  AnalyzeDeviceRef ->
  [SensorReading] ->
  ThresholdSource ->
  TrendDirection ->
  [AnomalyRecord] ->
  [CorrelationRecord] ->
  [(Severity, ScoreFactorRecord)] ->
  AnalysisResultRecord
scoreDevice hostId ruleVer analyzedAt dev readings thSrc trend anomalies correlations rulePenalties =
  let validReadings = filter (\r -> readingQuality r == QualityValid && readingValue r /= Nothing) readings
      staleReadings = filter (\r -> readingQuality r == QualityStale) readings
      faultReadings = filter (\r -> readingQuality r == QualitySensorFault) readings
      outOfRangeReadings = filter (\r -> readingQuality r == QualityOutOfRange) readings
   in if refDeviceStatus dev == DeviceStandby
        then
          AnalysisResultRecord
            { resHostId = hostId
            , resDeviceId = refDeviceId dev
            , resSeverity = SeverityNormal
            , resScore = Nothing
            , resEngineVersion = engineVersion engineInfo
            , resRuleVersion = ruleVer
            , resThresholdSource = thSrc
            , resTrend = TrendInsufficientData
            , resAnomalies = []
            , resCorrelations = []
            , resFactors =
                [ ScoreFactorRecord
                    { factorRecMetric = "device_status"
                    , factorRecDelta = 0.0
                    , factorRecReason = "Device is in standby mode; telemetry skipped without wake-up"
                    }
                ]
            , resAnalyzedAt = analyzedAt
            }
        else
          if null validReadings
            then
              let reason
                    | not (null staleReadings) = "DATA_STALE: latest telemetry is expired; cannot claim healthy"
                    | not (null faultReadings) = "SENSOR_FAULT_NOT_HARDWARE_FAILURE: sensor read error detected"
                    | otherwise = "INSUFFICIENT_DATA: no valid sensor readings available"
               in AnalysisResultRecord
                    { resHostId = hostId
                    , resDeviceId = refDeviceId dev
                    , resSeverity = SeverityUnknown
                    , resScore = Nothing
                    , resEngineVersion = engineVersion engineInfo
                    , resRuleVersion = ruleVer
                    , resThresholdSource = thSrc
                    , resTrend = trend
                    , resAnomalies = anomalies
                    , resCorrelations = correlations
                    , resFactors =
                        [ ScoreFactorRecord
                            { factorRecMetric = "quality"
                            , factorRecDelta = 0.0
                            , factorRecReason = reason
                            }
                        ]
                    , resAnalyzedAt = analyzedAt
                    }
            else
              let staleFactors =
                    [ ScoreFactorRecord
                        { factorRecMetric = readingMetric r
                        , factorRecDelta = 0.0
                        , factorRecReason = "DATA_STALE: reading expired for " <> readingSensorId r
                        }
                    | r <- staleReadings
                    ]
                  faultFactors =
                    [ ScoreFactorRecord
                        { factorRecMetric = readingMetric r
                        , factorRecDelta = 0.0
                        , factorRecReason = "SENSOR_FAULT_NOT_HARDWARE_FAILURE on " <> readingSensorId r
                        }
                    | r <- faultReadings
                    ]
                  oorFactors =
                    [ ScoreFactorRecord
                        { factorRecMetric = readingMetric r
                        , factorRecDelta = -10.0
                        , factorRecReason = "Reading out of valid physical range on " <> readingSensorId r
                        }
                    | r <- outOfRangeReadings
                    ]
                  anomFactors =
                    [ ScoreFactorRecord
                        { factorRecMetric = "anomaly"
                        , factorRecDelta = -10.0
                        , factorRecReason = anomalyRecCode a <> ": " <> anomalyRecReason a
                        }
                    | a <- anomalies
                    ]
                  corrFactors =
                    [ ScoreFactorRecord
                        { factorRecMetric = "correlation"
                        , factorRecDelta = -15.0
                        , factorRecReason = corrRecCode c <> ": " <> corrRecSummary c
                        }
                    | c <- correlations
                    ]
                  ruleFactors = map snd rulePenalties
                  allFactors =
                    ruleFactors
                      <> oorFactors
                      <> anomFactors
                      <> corrFactors
                      <> staleFactors
                      <> faultFactors
                  totalDelta = sum (map factorRecDelta allFactors)
                  rawScore = max 0.0 (min 100.0 (100.0 + totalDelta))
                  baseSev = foldr (maxSeverity . fst) SeverityNormal rulePenalties
                  sevWithOor =
                    if null outOfRangeReadings then baseSev else maxSeverity baseSev SeverityWarning
                  sevWithCorr =
                    if null correlations then sevWithOor else maxSeverity sevWithOor SeverityWarning
                  finalSev =
                    if not (null staleReadings) && sevWithCorr == SeverityNormal
                      then SeverityUnknown
                      else sevWithCorr
                  finalFactors =
                    if null allFactors
                      then
                        [ ScoreFactorRecord
                            { factorRecMetric = "overall"
                            , factorRecDelta = 0.0
                            , factorRecReason = "All supported metrics within expected thresholds"
                            }
                        ]
                      else allFactors
               in AnalysisResultRecord
                    { resHostId = hostId
                    , resDeviceId = refDeviceId dev
                    , resSeverity = finalSev
                    , resScore = Just rawScore
                    , resEngineVersion = engineVersion engineInfo
                    , resRuleVersion = ruleVer
                    , resThresholdSource = thSrc
                    , resTrend = trend
                    , resAnomalies = anomalies
                    , resCorrelations = correlations
                    , resFactors = finalFactors
                    , resAnalyzedAt = analyzedAt
                    }
