{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import Control.Monad (unless)
import Data.Aeson (eitherDecodeFileStrict)
import Health.Anomaly (detectAnomalies)
import Health.Correlation (detectCorrelations)
import Health.Engine (analyze, evaluateReadingQuality)
import Health.Protocol
import Health.StateMachine (stepAlertState)
import Health.Thresholds (ResolvedThreshold (..), resolveThreshold)
import Health.Trends (computeTrend)
import Health.Types (EngineInfo (..), engineInfo)
import System.Exit (exitFailure)

assertBool :: String -> Bool -> IO ()
assertBool label cond =
  unless cond $ do
    putStrLn $ "FAIL: " <> label
    exitFailure

mkReading :: String -> Double -> ReadingQuality -> SensorReading
mkReading metric val qual =
  SensorReading
    { readingSchemaVersion = "1.0"
    , readingHostId = "debian-host-01"
    , readingDeviceId = "cpu-system-0"
    , readingSensorId = "cpu-system-0-sensor"
    , readingMetric = case metric of
        "fan_speed" -> "fan_speed"
        _ -> "temperature"
    , readingValue = if qual == QualityMissing then Nothing else Just val
    , readingUnit = if metric == "fan_speed" then UnitRpm else UnitCelsius
    , readingQuality = qual
    , readingSource = "hwmon"
    , readingCollectedAt = "2026-11-20T10:00:00Z"
    }

mkHistory :: [Double] -> [HistoryPoint]
mkHistory =
  zipWith
    ( \idx v ->
        HistoryPoint
          { hpDeviceId = "cpu-system-0"
          , hpSensorId = "cpu-system-0-temp"
          , hpMetric = "temperature"
          , hpValue = Just v
          , hpQuality = QualityValid
          , hpCollectedAt = "2026-11-20T10:0" <> (if idx < 10 then "0" else "") <> ":00Z"
          }
    )
    ([0 :: Int ..])

main :: IO ()
main = do
  assertBool "protocol version 1.1" (engineProtocolVersion engineInfo == "1.1")

  -- 1. Stale & sensor_fault never evaluate to Normal
  assertBool
    "stale reading is Unknown"
    (evaluateReadingQuality (mkReading "temperature" 40.0 QualityStale) == SeverityUnknown)
  assertBool
    "sensor_fault reading is Unknown"
    (evaluateReadingQuality (mkReading "temperature" 40.0 QualitySensorFault) == SeverityUnknown)

  -- 2. Threshold priority: user device override > hardware limit > generic default > unavailable
  let hwLim = HardwareLimit "cpu-system-0" "temperature" UnitCelsius (Just 100) (Just 105) "coretemp-crit"
      userRule =
        AlertRuleSpec "r-user" "temperature" DevCpu (Just "cpu-system-0") OpGte 75 UnitCelsius 60 SeverityWarning True
      thUser = resolveThreshold DevCpu "cpu-system-0" "temperature" (Just userRule) [hwLim]
      thHw = resolveThreshold DevCpu "cpu-system-0" "temperature" Nothing [hwLim]
      thGen = resolveThreshold DevCpu "cpu-system-0" "temperature" Nothing []
      thUnavail = resolveThreshold DevOther "other-dev-0" "voltage" Nothing []
  assertBool "user device override wins" (resolvedSource thUser == ThUserDeviceOverride && resolvedValue thUser == Just 75)
  assertBool "hardware limit fallback" (resolvedSource thHw == ThHardwareLimit && resolvedValue thHw == Just 105)
  assertBool "generic default fallback" (resolvedSource thGen == ThGenericDefault && resolvedValue thGen == Just 85)
  assertBool "unavailable when no threshold exists" (resolvedSource thUnavail == ThUnavailable && resolvedValue thUnavail == Nothing)

  -- 3. Trends & Anomaly & Correlation
  assertBool "rising trend" (computeTrend (mkHistory [50, 55, 60, 66]) == TrendRising)
  assertBool "stable trend" (computeTrend (mkHistory [50, 50.1, 49.9, 50]) == TrendStable)
  assertBool "insufficient data trend" (computeTrend (mkHistory [50, 60]) == TrendInsufficientData)
  assertBool "spike anomaly detected" (not (null (detectAnomalies (mkHistory [40, 40.5, 39.8, 40.2, 40.1, 65.0]))))
  -- Phase 6: robust MAD resists single outlier contamination in baseline and detects sudden step-change
  let madAnoms = detectAnomalies (mkHistory [42, 42.2, 41.8, 95.0, 42.1, 41.9, 55.0])
  assertBool "robust MAD catches spike despite prior outlier" (any (\a -> anomalyRecCode a == "ROBUST_MAD_SPIKE") madAnoms)
  assertBool "sudden step-change detected" (any (\a -> anomalyRecCode a == "SUDDEN_STEP_CHANGE") madAnoms)
  assertBool "gentle normal fluctuation produces zero anomalies" (null (detectAnomalies (mkHistory [45, 45.5, 46.0, 45.2, 45.8, 46.1])))
  let corrs = detectCorrelations [mkReading "temperature" 82 QualityValid, mkReading "fan_speed" 0 QualityValid] TrendRising
  assertBool "high temp + 0 RPM fan correlated" (any (\c -> corrRecCode c == "THERMAL_WITH_STOPPED_FAN") corrs)

  -- 4. Alert State Machine: Ok -> Pending -> Firing (after duration) -> Hysteresis hold -> Resolve
  let rule60 =
        AlertRuleSpec "cpu-hot" "temperature" DevCpu Nothing OpGte 80 UnitCelsius 60 SeverityWarning True
      (s1, t1) = stepAlertState "host-1" "cpu-system-0" "2026-11-20T10:00:00Z" rule60 ThGenericDefault (Just 82) Nothing
  assertBool "enters Pending before duration elapsed" (snapState s1 == AlertStatePending && t1 == Nothing)

  let (s2, t2) = stepAlertState "host-1" "cpu-system-0" "2026-11-20T10:01:05Z" rule60 ThGenericDefault (Just 83) (Just s1)
  assertBool "fires after duration elapsed" (snapState s2 == AlertStateFiring && fmap transKind t2 == Just TransitionTrigger)

  -- 79.0 is still within 5% hysteresis band (threshold 80 -> must drop below 76 to clear)
  let (s3, t3) = stepAlertState "host-1" "cpu-system-0" "2026-11-20T10:02:00Z" rule60 ThGenericDefault (Just 79) (Just s2)
  assertBool "hysteresis holds Firing at 79" (snapState s3 == AlertStateFiring && t3 == Nothing)

  let (s4, t4) = stepAlertState "host-1" "cpu-system-0" "2026-11-20T10:03:00Z" rule60 ThGenericDefault (Just 70) (Just s3)
  assertBool "resolves cleanly at 70" (snapState s4 == AlertStateResolved && fmap transKind t4 == Just TransitionResolve)

  -- 5. Full analyze(): stale device -> SeverityUnknown + score Nothing; healthy 0 RPM fan -> Normal + score 100
  let req =
        AnalyzeRequest
          { reqSchemaVersion = "1.1"
          , reqHostId = "debian-host-01"
          , reqEvaluatedAt = "2026-11-20T10:05:00Z"
          , reqRuleVersion = "rules-v1"
          , reqDevices =
              [ AnalyzeDeviceRef "cpu-system-0" DevCpu DeviceOnline
              , AnalyzeDeviceRef "disk-standby-0" DevStorage DeviceStandby
              ]
          , reqReadings = [mkReading "temperature" 45 QualityStale]
          , reqHistoryPoints = []
          , reqRules = [rule60]
          , reqHardwareLimits = [hwLim]
          , reqPrevAlertStates = []
          }
      resp = analyze req
  case respAnalysisResults resp of
    [cpuRes, standbyRes] -> do
      assertBool "stale CPU cannot be Normal" (resSeverity cpuRes == SeverityUnknown && resScore cpuRes == Nothing)
      assertBool "standby disk is Normal without penalty" (resSeverity standbyRes == SeverityNormal && resScore standbyRes == Nothing)
    _ -> assertBool "expected 2 device results" False

  -- 6. M-8 regression: global rule threshold source matches the rule value (not mislabeled hardware_limit)
  let thGlobalWithHw = resolveThreshold DevCpu "cpu-system-0" "temperature" (Just rule60) [hwLim]
  assertBool
    "global rule does not mislabel source as hardware_limit"
    (resolvedSource thGlobalWithHw == ThGenericDefault && resolvedValue thGlobalWithHw == Just 80)

  -- 7. M-9 regression: OpLt / OpLte uses minimum across multi-sensor readings so stopped 0 RPM fan triggers
  let fanRule =
        AlertRuleSpec "fan-stopped" "fan_speed" DevMotherboard Nothing OpLt 500 UnitRpm 0 SeverityCritical True
      fanReq =
        AnalyzeRequest
          { reqSchemaVersion = "1.1"
          , reqHostId = "debian-host-01"
          , reqEvaluatedAt = "2026-11-20T10:05:00Z"
          , reqRuleVersion = "rules-v1"
          , reqDevices = [AnalyzeDeviceRef "mb-0" DevMotherboard DeviceOnline]
          , reqReadings =
              [ (mkReading "fan_speed" 1800 QualityValid) {readingDeviceId = "mb-0", readingSensorId = "mb-0-fan1"}
              , (mkReading "fan_speed" 0 QualityValid) {readingDeviceId = "mb-0", readingSensorId = "mb-0-fan2"}
              ]
          , reqHistoryPoints = []
          , reqRules = [fanRule]
          , reqHardwareLimits = []
          , reqPrevAlertStates = []
          }
      fanResp = analyze fanReq
  assertBool
    "OpLt rule catches 0 RPM stopped fan despite another fan at 1800 RPM"
    (any (\tr -> transRuleId tr == "fan-stopped" && transObservedValue tr == Just 0.0 && transKind tr == TransitionTrigger) (respAlertTransitions fanResp))

  -- 8. H-1 regression: golden analyze-request.json fed into real Health.Engine.analyze MUST match analyze-response.json
  eReq <- eitherDecodeFileStrict "../../packages/protocol/examples/valid/analyze-request.json" :: IO (Either String AnalyzeRequest)
  eExp <- eitherDecodeFileStrict "../../packages/protocol/examples/valid/analyze-response.json" :: IO (Either String AnalyzeResponse)
  case (eReq, eExp) of
    (Right gReq, Right gExp) -> do
      let gActual = analyze gReq
      assertBool
        ("golden analyze-response.json must match actual Health.Engine.analyze output; got: " <> show gActual)
        (gActual == gExp)
    (Left err, _) -> assertBool ("failed to decode golden analyze-request.json: " <> err) False
    (_, Left err) -> assertBool ("failed to decode golden analyze-response.json: " <> err) False

  putStrLn "All Haskell health-engine Phase 4 tests passed."
