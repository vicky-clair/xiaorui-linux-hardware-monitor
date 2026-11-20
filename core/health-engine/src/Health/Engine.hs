{-# LANGUAGE OverloadedStrings #-}

module Health.Engine
  ( evaluateReadingQuality
  ) where

import Health.Protocol (ReadingQuality (..), SensorReading (..), Severity (..))

-- | Minimal Phase 0 invariant check: stale/missing/faulty readings never evaluate to Normal.
evaluateReadingQuality :: SensorReading -> Severity
evaluateReadingQuality r = case readingQuality r of
  QualityValid -> SeverityNormal
  QualityStale -> SeverityUnknown
  QualityMissing -> SeverityUnknown
  QualitySensorFault -> SeverityUnknown
  QualityOutOfRange -> SeverityWarning
