{-# LANGUAGE OverloadedStrings #-}

module Lhm.Protocol
  ( protocolName
  , schemaVersion
  , CapabilityStatus (..)
  , ReadingQuality (..)
  , DeviceStatus (..)
  , Severity (..)
  , Unit (..)
  , DeviceType (..)
  , SensorType (..)
  , UintString (..)
  , mkUintString
  , Host (..)
  , DeviceIdentity (..)
  , Device (..)
  , Sensor (..)
  , SensorReading (..)
  , CollectorRunStatus (..)
  , CollectorStatus (..)
  , DiagnosticLevel (..)
  , Diagnostic (..)
  , SmartProtocolType (..)
  , SmartAttribute (..)
  , SmartReport (..)
  , IpcMessageType (..)
  , IpcMessage (..)
  , RuleOperator (..)
  , ThresholdSource (..)
  , TrendDirection (..)
  , AlertStateName (..)
  , AlertTransitionKind (..)
  , AlertRuleSpec (..)
  , HardwareLimit (..)
  , AlertStateSnapshot (..)
  , AnalyzeDeviceRef (..)
  , HistoryPoint (..)
  , AnalyzeRequest (..)
  , AnomalyRecord (..)
  , CorrelationRecord (..)
  , ScoreFactorRecord (..)
  , AnalysisResultRecord (..)
  , AlertTransitionRecord (..)
  , AnalyzeResponse (..)
  ) where

import Data.Aeson
  ( FromJSON (..)
  , ToJSON (..)
  , Value
  , object
  , withObject
  , withText
  , (.:)
  , (.:?)
  , (.=)
  )
import Data.Char (isDigit)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Word (Word64)

protocolName :: Text
protocolName = "lhm-ipc"

schemaVersion :: Text
schemaVersion = "1.0"

data CapabilityStatus
  = CapSupported
  | CapUnsupported
  | CapPermissionDenied
  | CapUnavailable
  | CapUnknown
  deriving (Eq, Show)

instance ToJSON CapabilityStatus where
  toJSON CapSupported = "supported"
  toJSON CapUnsupported = "unsupported"
  toJSON CapPermissionDenied = "permission_denied"
  toJSON CapUnavailable = "unavailable"
  toJSON CapUnknown = "unknown"

instance FromJSON CapabilityStatus where
  parseJSON = withText "CapabilityStatus" $ \t -> case t of
    "supported" -> pure CapSupported
    "unsupported" -> pure CapUnsupported
    "permission_denied" -> pure CapPermissionDenied
    "unavailable" -> pure CapUnavailable
    "unknown" -> pure CapUnknown
    _ -> fail $ "Invalid CapabilityStatus: " <> T.unpack t

data ReadingQuality
  = QualityValid
  | QualityStale
  | QualitySensorFault
  | QualityOutOfRange
  | QualityMissing
  deriving (Eq, Show)

instance ToJSON ReadingQuality where
  toJSON QualityValid = "valid"
  toJSON QualityStale = "stale"
  toJSON QualitySensorFault = "sensor_fault"
  toJSON QualityOutOfRange = "out_of_range"
  toJSON QualityMissing = "missing"

instance FromJSON ReadingQuality where
  parseJSON = withText "ReadingQuality" $ \t -> case t of
    "valid" -> pure QualityValid
    "stale" -> pure QualityStale
    "sensor_fault" -> pure QualitySensorFault
    "out_of_range" -> pure QualityOutOfRange
    "missing" -> pure QualityMissing
    _ -> fail $ "Invalid ReadingQuality: " <> T.unpack t

data DeviceStatus
  = DeviceOnline
  | DeviceStandby
  | DeviceOffline
  | DeviceUnknown
  deriving (Eq, Show)

instance ToJSON DeviceStatus where
  toJSON DeviceOnline = "online"
  toJSON DeviceStandby = "standby"
  toJSON DeviceOffline = "offline"
  toJSON DeviceUnknown = "unknown"

instance FromJSON DeviceStatus where
  parseJSON = withText "DeviceStatus" $ \t -> case t of
    "online" -> pure DeviceOnline
    "standby" -> pure DeviceStandby
    "offline" -> pure DeviceOffline
    "unknown" -> pure DeviceUnknown
    _ -> fail $ "Invalid DeviceStatus: " <> T.unpack t

data Severity
  = SeverityNormal
  | SeverityWarning
  | SeverityCritical
  | SeverityUnknown
  deriving (Eq, Show)

instance ToJSON Severity where
  toJSON SeverityNormal = "normal"
  toJSON SeverityWarning = "warning"
  toJSON SeverityCritical = "critical"
  toJSON SeverityUnknown = "unknown"

instance FromJSON Severity where
  parseJSON = withText "Severity" $ \t -> case t of
    "normal" -> pure SeverityNormal
    "warning" -> pure SeverityWarning
    "critical" -> pure SeverityCritical
    "unknown" -> pure SeverityUnknown
    _ -> fail $ "Invalid Severity: " <> T.unpack t

data Unit
  = UnitCelsius
  | UnitRpm
  | UnitVolt
  | UnitWatt
  | UnitAmpere
  | UnitPercent
  | UnitHertz
  | UnitByte
  | UnitBytePerSecond
  | UnitSecond
  | UnitCount
  deriving (Eq, Show)

instance ToJSON Unit where
  toJSON UnitCelsius = "celsius"
  toJSON UnitRpm = "rpm"
  toJSON UnitVolt = "volt"
  toJSON UnitWatt = "watt"
  toJSON UnitAmpere = "ampere"
  toJSON UnitPercent = "percent"
  toJSON UnitHertz = "hertz"
  toJSON UnitByte = "byte"
  toJSON UnitBytePerSecond = "byte_per_second"
  toJSON UnitSecond = "second"
  toJSON UnitCount = "count"

instance FromJSON Unit where
  parseJSON = withText "Unit" $ \t -> case t of
    "celsius" -> pure UnitCelsius
    "rpm" -> pure UnitRpm
    "volt" -> pure UnitVolt
    "watt" -> pure UnitWatt
    "ampere" -> pure UnitAmpere
    "percent" -> pure UnitPercent
    "hertz" -> pure UnitHertz
    "byte" -> pure UnitByte
    "byte_per_second" -> pure UnitBytePerSecond
    "second" -> pure UnitSecond
    "count" -> pure UnitCount
    _ -> fail $ "Invalid Unit: " <> T.unpack t

data DeviceType
  = DevCpu
  | DevGpu
  | DevMotherboard
  | DevMemory
  | DevStorage
  | DevFan
  | DevPsu
  | DevNetwork
  | DevSystem
  | DevOther
  deriving (Eq, Show)

instance ToJSON DeviceType where
  toJSON DevCpu = "cpu"
  toJSON DevGpu = "gpu"
  toJSON DevMotherboard = "motherboard"
  toJSON DevMemory = "memory"
  toJSON DevStorage = "storage"
  toJSON DevFan = "fan"
  toJSON DevPsu = "psu"
  toJSON DevNetwork = "network"
  toJSON DevSystem = "system"
  toJSON DevOther = "other"

instance FromJSON DeviceType where
  parseJSON = withText "DeviceType" $ \t -> case t of
    "cpu" -> pure DevCpu
    "gpu" -> pure DevGpu
    "motherboard" -> pure DevMotherboard
    "memory" -> pure DevMemory
    "storage" -> pure DevStorage
    "fan" -> pure DevFan
    "psu" -> pure DevPsu
    "network" -> pure DevNetwork
    "system" -> pure DevSystem
    "other" -> pure DevOther
    _ -> fail $ "Invalid DeviceType: " <> T.unpack t

data SensorType
  = SenTemperature
  | SenFanSpeed
  | SenVoltage
  | SenPower
  | SenCurrent
  | SenUtilization
  | SenFrequency
  | SenMemory
  | SenThroughput
  | SenErrorCount
  | SenDuration
  | SenOther
  deriving (Eq, Show)

instance ToJSON SensorType where
  toJSON SenTemperature = "temperature"
  toJSON SenFanSpeed = "fan_speed"
  toJSON SenVoltage = "voltage"
  toJSON SenPower = "power"
  toJSON SenCurrent = "current"
  toJSON SenUtilization = "utilization"
  toJSON SenFrequency = "frequency"
  toJSON SenMemory = "memory"
  toJSON SenThroughput = "throughput"
  toJSON SenErrorCount = "error_count"
  toJSON SenDuration = "duration"
  toJSON SenOther = "other"

instance FromJSON SensorType where
  parseJSON = withText "SensorType" $ \t -> case t of
    "temperature" -> pure SenTemperature
    "fan_speed" -> pure SenFanSpeed
    "voltage" -> pure SenVoltage
    "power" -> pure SenPower
    "current" -> pure SenCurrent
    "utilization" -> pure SenUtilization
    "frequency" -> pure SenFrequency
    "memory" -> pure SenMemory
    "throughput" -> pure SenThroughput
    "error_count" -> pure SenErrorCount
    "duration" -> pure SenDuration
    "other" -> pure SenOther
    _ -> fail $ "Invalid SensorType: " <> T.unpack t

newtype UintString = UintString {unUintString :: Text}
  deriving (Eq, Show)

mkUintString :: Text -> Either String UintString
mkUintString t
  | not (T.null t) && T.all isDigit t = Right (UintString t)
  | otherwise = Left $ "Invalid UintString (must be decimal digits): " <> T.unpack t

instance ToJSON UintString where
  toJSON (UintString t) = toJSON t

instance FromJSON UintString where
  parseJSON = withText "UintString" $ \t ->
    case mkUintString t of
      Right u -> pure u
      Left err -> fail err

data Host = Host
  { hostId :: Text
  , hostName :: Text
  , hostOsName :: Text
  , hostOsVersion :: Text
  , hostKernelVersion :: Text
  , hostArchitecture :: Text
  , hostAgentVersion :: Text
  , hostBootTime :: Maybe Text
  , hostUptimeSeconds :: Maybe Word64
  }
  deriving (Eq, Show)

instance ToJSON Host where
  toJSON h =
    object
      [ "host_id" .= hostId h
      , "hostname" .= hostName h
      , "os_name" .= hostOsName h
      , "os_version" .= hostOsVersion h
      , "kernel_version" .= hostKernelVersion h
      , "architecture" .= hostArchitecture h
      , "agent_version" .= hostAgentVersion h
      , "boot_time" .= hostBootTime h
      , "uptime_seconds" .= hostUptimeSeconds h
      ]

instance FromJSON Host where
  parseJSON = withObject "Host" $ \o ->
    Host
      <$> o .: "host_id"
      <*> o .: "hostname"
      <*> o .: "os_name"
      <*> o .: "os_version"
      <*> o .: "kernel_version"
      <*> o .: "architecture"
      <*> o .: "agent_version"
      <*> o .:? "boot_time"
      <*> o .:? "uptime_seconds"

data DeviceIdentity = DeviceIdentity
  { idStable :: Bool
  , idPciBusId :: Maybe Text
  , idPciVendorId :: Maybe Text
  , idPciDeviceId :: Maybe Text
  , idWwn :: Maybe Text
  , idSerial :: Maybe Text
  , idNvmeNguid :: Maybe Text
  , idDriver :: Maybe Text
  , idRawPath :: Maybe Text
  , idTopology :: Maybe Text
  }
  deriving (Eq, Show)

instance ToJSON DeviceIdentity where
  toJSON i =
    object
      [ "stable" .= idStable i
      , "pci_bus_id" .= idPciBusId i
      , "pci_vendor_id" .= idPciVendorId i
      , "pci_device_id" .= idPciDeviceId i
      , "wwn" .= idWwn i
      , "serial" .= idSerial i
      , "nvme_nguid" .= idNvmeNguid i
      , "driver" .= idDriver i
      , "raw_path" .= idRawPath i
      , "topology" .= idTopology i
      ]

instance FromJSON DeviceIdentity where
  parseJSON = withObject "DeviceIdentity" $ \o ->
    DeviceIdentity
      <$> o .: "stable"
      <*> o .:? "pci_bus_id"
      <*> o .:? "pci_vendor_id"
      <*> o .:? "pci_device_id"
      <*> o .:? "wwn"
      <*> o .:? "serial"
      <*> o .:? "nvme_nguid"
      <*> o .:? "driver"
      <*> o .:? "raw_path"
      <*> o .:? "topology"

data Device = Device
  { deviceId :: Text
  , deviceHostId :: Text
  , deviceType :: DeviceType
  , deviceVendor :: Text
  , deviceModel :: Text
  , deviceName :: Text
  , deviceIdentity :: DeviceIdentity
  , deviceCapabilities :: [Text]
  , deviceStatus :: DeviceStatus
  }
  deriving (Eq, Show)

instance ToJSON Device where
  toJSON d =
    object
      [ "device_id" .= deviceId d
      , "host_id" .= deviceHostId d
      , "device_type" .= deviceType d
      , "vendor" .= deviceVendor d
      , "model" .= deviceModel d
      , "name" .= deviceName d
      , "identity" .= deviceIdentity d
      , "capabilities" .= deviceCapabilities d
      , "device_status" .= deviceStatus d
      ]

instance FromJSON Device where
  parseJSON = withObject "Device" $ \o ->
    Device
      <$> o .: "device_id"
      <*> o .: "host_id"
      <*> o .: "device_type"
      <*> o .: "vendor"
      <*> o .: "model"
      <*> o .: "name"
      <*> o .: "identity"
      <*> o .: "capabilities"
      <*> o .: "device_status"

data Sensor = Sensor
  { sensorId :: Text
  , sensorDeviceId :: Text
  , sensorType :: SensorType
  , sensorName :: Text
  , sensorSource :: Text
  , sensorUnit :: Unit
  , sensorCapabilityStatus :: CapabilityStatus
  , sensorEnabled :: Bool
  }
  deriving (Eq, Show)

instance ToJSON Sensor where
  toJSON s =
    object
      [ "sensor_id" .= sensorId s
      , "device_id" .= sensorDeviceId s
      , "sensor_type" .= sensorType s
      , "sensor_name" .= sensorName s
      , "source" .= sensorSource s
      , "unit" .= sensorUnit s
      , "capability_status" .= sensorCapabilityStatus s
      , "enabled" .= sensorEnabled s
      ]

instance FromJSON Sensor where
  parseJSON = withObject "Sensor" $ \o ->
    Sensor
      <$> o .: "sensor_id"
      <*> o .: "device_id"
      <*> o .: "sensor_type"
      <*> o .: "sensor_name"
      <*> o .: "source"
      <*> o .: "unit"
      <*> o .: "capability_status"
      <*> o .: "enabled"

data SensorReading = SensorReading
  { readingSchemaVersion :: Text
  , readingHostId :: Text
  , readingDeviceId :: Text
  , readingSensorId :: Text
  , readingMetric :: Text
  , readingValue :: Maybe Double
  , readingUnit :: Unit
  , readingQuality :: ReadingQuality
  , readingSource :: Text
  , readingCollectedAt :: Text
  }
  deriving (Eq, Show)

instance ToJSON SensorReading where
  toJSON r =
    object
      [ "schema_version" .= readingSchemaVersion r
      , "host_id" .= readingHostId r
      , "device_id" .= readingDeviceId r
      , "sensor_id" .= readingSensorId r
      , "metric" .= readingMetric r
      , "value" .= readingValue r
      , "unit" .= readingUnit r
      , "quality" .= readingQuality r
      , "source" .= readingSource r
      , "collected_at" .= readingCollectedAt r
      ]

instance FromJSON SensorReading where
  parseJSON = withObject "SensorReading" $ \o -> do
    r <-
      SensorReading
        <$> o .: "schema_version"
        <*> o .: "host_id"
        <*> o .: "device_id"
        <*> o .: "sensor_id"
        <*> o .: "metric"
        <*> o .: "value"
        <*> o .: "unit"
        <*> o .: "quality"
        <*> o .: "source"
        <*> o .: "collected_at"
    case (readingQuality r, readingValue r) of
      (QualityValid, Nothing) ->
        fail "quality=valid requires a numeric value"
      (QualityMissing, Just _) ->
        fail "quality=missing requires value=null"
      _ -> pure r

data CollectorRunStatus
  = CollectorRunning
  | CollectorDegraded
  | CollectorStopped
  | CollectorError
  deriving (Eq, Show)

instance ToJSON CollectorRunStatus where
  toJSON CollectorRunning = "running"
  toJSON CollectorDegraded = "degraded"
  toJSON CollectorStopped = "stopped"
  toJSON CollectorError = "error"

instance FromJSON CollectorRunStatus where
  parseJSON = withText "CollectorRunStatus" $ \t -> case t of
    "running" -> pure CollectorRunning
    "degraded" -> pure CollectorDegraded
    "stopped" -> pure CollectorStopped
    "error" -> pure CollectorError
    _ -> fail $ "Invalid CollectorRunStatus: " <> T.unpack t

data CollectorStatus = CollectorStatus
  { collectorName :: Text
  , collectorHostId :: Text
  , collectorStatus :: CollectorRunStatus
  , collectorCapabilityStatus :: CapabilityStatus
  , collectorIntervalSeconds :: Word64
  , collectorLastRunAt :: Maybe Text
  , collectorLastSuccessAt :: Maybe Text
  , collectorConsecutiveFailures :: Word64
  , collectorLastErrorCode :: Maybe Text
  , collectorLastErrorMessage :: Maybe Text
  }
  deriving (Eq, Show)

instance ToJSON CollectorStatus where
  toJSON c =
    object
      [ "collector_name" .= collectorName c
      , "host_id" .= collectorHostId c
      , "status" .= collectorStatus c
      , "capability_status" .= collectorCapabilityStatus c
      , "interval_seconds" .= collectorIntervalSeconds c
      , "last_run_at" .= collectorLastRunAt c
      , "last_success_at" .= collectorLastSuccessAt c
      , "consecutive_failures" .= collectorConsecutiveFailures c
      , "last_error_code" .= collectorLastErrorCode c
      , "last_error_message" .= collectorLastErrorMessage c
      ]

instance FromJSON CollectorStatus where
  parseJSON = withObject "CollectorStatus" $ \o ->
    CollectorStatus
      <$> o .: "collector_name"
      <*> o .: "host_id"
      <*> o .: "status"
      <*> o .: "capability_status"
      <*> o .: "interval_seconds"
      <*> o .:? "last_run_at"
      <*> o .:? "last_success_at"
      <*> o .: "consecutive_failures"
      <*> o .:? "last_error_code"
      <*> o .:? "last_error_message"

data DiagnosticLevel
  = DiagInfo
  | DiagWarn
  | DiagError
  deriving (Eq, Show)

instance ToJSON DiagnosticLevel where
  toJSON DiagInfo = "info"
  toJSON DiagWarn = "warn"
  toJSON DiagError = "error"

instance FromJSON DiagnosticLevel where
  parseJSON = withText "DiagnosticLevel" $ \t -> case t of
    "info" -> pure DiagInfo
    "warn" -> pure DiagWarn
    "error" -> pure DiagError
    _ -> fail $ "Invalid DiagnosticLevel: " <> T.unpack t

data Diagnostic = Diagnostic
  { diagId :: Text
  , diagHostId :: Text
  , diagDeviceId :: Maybe Text
  , diagCollectorName :: Maybe Text
  , diagLevel :: DiagnosticLevel
  , diagErrorCode :: Text
  , diagSource :: Text
  , diagMessage :: Text
  , diagRemediation :: Maybe Text
  , diagOccurredAt :: Text
  , diagDetails :: Maybe Value
  }
  deriving (Eq, Show)

instance ToJSON Diagnostic where
  toJSON d =
    object
      [ "diagnostic_id" .= diagId d
      , "host_id" .= diagHostId d
      , "device_id" .= diagDeviceId d
      , "collector_name" .= diagCollectorName d
      , "level" .= diagLevel d
      , "error_code" .= diagErrorCode d
      , "source" .= diagSource d
      , "message" .= diagMessage d
      , "remediation" .= diagRemediation d
      , "occurred_at" .= diagOccurredAt d
      , "details" .= diagDetails d
      ]

instance FromJSON Diagnostic where
  parseJSON = withObject "Diagnostic" $ \o ->
    Diagnostic
      <$> o .: "diagnostic_id"
      <*> o .: "host_id"
      <*> o .:? "device_id"
      <*> o .:? "collector_name"
      <*> o .: "level"
      <*> o .: "error_code"
      <*> o .: "source"
      <*> o .: "message"
      <*> o .:? "remediation"
      <*> o .: "occurred_at"
      <*> o .:? "details"

data SmartProtocolType
  = SmartAta
  | SmartNvme
  | SmartScsi
  | SmartUnknown
  deriving (Eq, Show)

instance ToJSON SmartProtocolType where
  toJSON SmartAta = "ata"
  toJSON SmartNvme = "nvme"
  toJSON SmartScsi = "scsi"
  toJSON SmartUnknown = "unknown"

instance FromJSON SmartProtocolType where
  parseJSON = withText "SmartProtocolType" $ \t -> case t of
    "ata" -> pure SmartAta
    "nvme" -> pure SmartNvme
    "scsi" -> pure SmartScsi
    "unknown" -> pure SmartUnknown
    _ -> fail $ "Invalid SmartProtocolType: " <> T.unpack t

data SmartAttribute = SmartAttribute
  { smartAttrId :: Int
  , smartAttrName :: Text
  , smartAttrValue :: Maybe Int
  , smartAttrWorst :: Maybe Int
  , smartAttrThreshold :: Maybe Int
  , smartAttrRawValue :: UintString
  , smartAttrRawString :: Maybe Text
  }
  deriving (Eq, Show)

instance ToJSON SmartAttribute where
  toJSON a =
    object
      [ "id" .= smartAttrId a
      , "name" .= smartAttrName a
      , "value" .= smartAttrValue a
      , "worst" .= smartAttrWorst a
      , "threshold" .= smartAttrThreshold a
      , "raw_value" .= smartAttrRawValue a
      , "raw_string" .= smartAttrRawString a
      ]

instance FromJSON SmartAttribute where
  parseJSON = withObject "SmartAttribute" $ \o ->
    SmartAttribute
      <$> o .: "id"
      <*> o .: "name"
      <*> o .:? "value"
      <*> o .:? "worst"
      <*> o .:? "threshold"
      <*> o .: "raw_value"
      <*> o .:? "raw_string"

data SmartReport = SmartReport
  { smartSchemaVersion :: Text
  , smartHostId :: Text
  , smartDeviceId :: Text
  , smartDevicePath :: Text
  , smartProtocolType :: SmartProtocolType
  , smartDeviceStatus :: DeviceStatus
  , smartPassed :: Maybe Bool
  , smartTemperatureCelsius :: Maybe Double
  , smartPowerOnHours :: Maybe UintString
  , smartPowerCycles :: Maybe UintString
  , smartDataUnitsRead :: Maybe UintString
  , smartDataUnitsWritten :: Maybe UintString
  , smartPercentageUsed :: Maybe Double
  , smartAvailableSpare :: Maybe Double
  , smartCriticalWarning :: Maybe Word64
  , smartFirmwareVersion :: Maybe Text
  , smartSerialNumber :: Maybe Text
  , smartRotationRateRpm :: Maybe Word64
  , smartSataLinkSpeed :: Maybe Text
  , smartApmLevel :: Maybe Word64
  , smartWriteCacheEnabled :: Maybe Bool
  , smartTrimSupported :: Maybe Bool
  , smartSelfTestPassed :: Maybe Bool
  , smartSelfTestLastStatus :: Maybe Text
  , smartSelfTestLastHours :: Maybe UintString
  , smartErrorLogCount :: Maybe Word64
  , smartMediaErrors :: Maybe UintString
  , smartNumErrLogEntries :: Maybe UintString
  , smartUnsafeShutdowns :: Maybe UintString
  , smartWarningTempTimeMin :: Maybe Word64
  , smartCriticalCompTimeMin :: Maybe Word64
  , smartTemperatureSensorsCelsius :: Maybe [Double]
  , smartAttributes :: [SmartAttribute]
  , smartCollectedAt :: Text
  }
  deriving (Eq, Show)

instance ToJSON SmartReport where
  toJSON r =
    object
      [ "schema_version" .= smartSchemaVersion r
      , "host_id" .= smartHostId r
      , "device_id" .= smartDeviceId r
      , "device_path" .= smartDevicePath r
      , "protocol_type" .= smartProtocolType r
      , "device_status" .= smartDeviceStatus r
      , "smart_passed" .= smartPassed r
      , "temperature_celsius" .= smartTemperatureCelsius r
      , "power_on_hours" .= smartPowerOnHours r
      , "power_cycles" .= smartPowerCycles r
      , "data_units_read" .= smartDataUnitsRead r
      , "data_units_written" .= smartDataUnitsWritten r
      , "percentage_used" .= smartPercentageUsed r
      , "available_spare" .= smartAvailableSpare r
      , "critical_warning" .= smartCriticalWarning r
      , "firmware_version" .= smartFirmwareVersion r
      , "serial_number" .= smartSerialNumber r
      , "rotation_rate_rpm" .= smartRotationRateRpm r
      , "sata_link_speed" .= smartSataLinkSpeed r
      , "apm_level" .= smartApmLevel r
      , "write_cache_enabled" .= smartWriteCacheEnabled r
      , "trim_supported" .= smartTrimSupported r
      , "self_test_passed" .= smartSelfTestPassed r
      , "self_test_last_status" .= smartSelfTestLastStatus r
      , "self_test_last_hours" .= smartSelfTestLastHours r
      , "error_log_count" .= smartErrorLogCount r
      , "media_errors" .= smartMediaErrors r
      , "num_err_log_entries" .= smartNumErrLogEntries r
      , "unsafe_shutdowns" .= smartUnsafeShutdowns r
      , "warning_temp_time_min" .= smartWarningTempTimeMin r
      , "critical_comp_time_min" .= smartCriticalCompTimeMin r
      , "temperature_sensors_celsius" .= smartTemperatureSensorsCelsius r
      , "attributes" .= smartAttributes r
      , "collected_at" .= smartCollectedAt r
      ]

instance FromJSON SmartReport where
  parseJSON = withObject "SmartReport" $ \o ->
    SmartReport
      <$> o .: "schema_version"
      <*> o .: "host_id"
      <*> o .: "device_id"
      <*> o .: "device_path"
      <*> o .: "protocol_type"
      <*> o .: "device_status"
      <*> o .:? "smart_passed"
      <*> o .:? "temperature_celsius"
      <*> o .:? "power_on_hours"
      <*> o .:? "power_cycles"
      <*> o .:? "data_units_read"
      <*> o .:? "data_units_written"
      <*> o .:? "percentage_used"
      <*> o .:? "available_spare"
      <*> o .:? "critical_warning"
      <*> o .:? "firmware_version"
      <*> o .:? "serial_number"
      <*> o .:? "rotation_rate_rpm"
      <*> o .:? "sata_link_speed"
      <*> o .:? "apm_level"
      <*> o .:? "write_cache_enabled"
      <*> o .:? "trim_supported"
      <*> o .:? "self_test_passed"
      <*> o .:? "self_test_last_status"
      <*> o .:? "self_test_last_hours"
      <*> o .:? "error_log_count"
      <*> o .:? "media_errors"
      <*> o .:? "num_err_log_entries"
      <*> o .:? "unsafe_shutdowns"
      <*> o .:? "warning_temp_time_min"
      <*> o .:? "critical_comp_time_min"
      <*> o .:? "temperature_sensors_celsius"
      <*> o .: "attributes"
      <*> o .: "collected_at"

data IpcMessageType
  = IpcHello
  | IpcHelloAck
  | IpcHeartbeat
  | IpcAck
  | IpcInventory
  | IpcSensorReadings
  | IpcSmartReport
  | IpcCollectorStatus
  | IpcDiagnostic
  | IpcError
  deriving (Eq, Show)

instance ToJSON IpcMessageType where
  toJSON IpcHello = "hello"
  toJSON IpcHelloAck = "hello_ack"
  toJSON IpcHeartbeat = "heartbeat"
  toJSON IpcAck = "ack"
  toJSON IpcInventory = "inventory"
  toJSON IpcSensorReadings = "sensor_readings"
  toJSON IpcSmartReport = "smart_report"
  toJSON IpcCollectorStatus = "collector_status"
  toJSON IpcDiagnostic = "diagnostic"
  toJSON IpcError = "error"

instance FromJSON IpcMessageType where
  parseJSON = withText "IpcMessageType" $ \t -> case t of
    "hello" -> pure IpcHello
    "hello_ack" -> pure IpcHelloAck
    "heartbeat" -> pure IpcHeartbeat
    "ack" -> pure IpcAck
    "inventory" -> pure IpcInventory
    "sensor_readings" -> pure IpcSensorReadings
    "smart_report" -> pure IpcSmartReport
    "collector_status" -> pure IpcCollectorStatus
    "diagnostic" -> pure IpcDiagnostic
    "error" -> pure IpcError
    _ -> fail $ "Invalid IpcMessageType: " <> T.unpack t

data IpcMessage = IpcMessage
  { ipcProtocol :: Text
  , ipcSchemaVersion :: Text
  , ipcMessageId :: Text
  , ipcMessageType :: IpcMessageType
  , ipcHostId :: Text
  , ipcAgentInstanceId :: Text
  , ipcSequence :: Word64
  , ipcSentAt :: Text
  , ipcPayload :: Value
  }
  deriving (Eq, Show)

instance ToJSON IpcMessage where
  toJSON m =
    object
      [ "protocol" .= ipcProtocol m
      , "schema_version" .= ipcSchemaVersion m
      , "message_id" .= ipcMessageId m
      , "message_type" .= ipcMessageType m
      , "host_id" .= ipcHostId m
      , "agent_instance_id" .= ipcAgentInstanceId m
      , "sequence" .= ipcSequence m
      , "sent_at" .= ipcSentAt m
      , "payload" .= ipcPayload m
      ]

instance FromJSON IpcMessage where
  parseJSON = withObject "IpcMessage" $ \o -> do
    proto <- o .: "protocol"
    if proto /= protocolName
      then fail $ "Unexpected IPC protocol: " <> T.unpack proto
      else
        IpcMessage proto
          <$> o .: "schema_version"
          <*> o .: "message_id"
          <*> o .: "message_type"
          <*> o .: "host_id"
          <*> o .: "agent_instance_id"
          <*> o .: "sequence"
          <*> o .: "sent_at"
          <*> o .: "payload"

data RuleOperator
  = OpGt
  | OpGte
  | OpLt
  | OpLte
  deriving (Eq, Show)

instance ToJSON RuleOperator where
  toJSON OpGt = "gt"
  toJSON OpGte = "gte"
  toJSON OpLt = "lt"
  toJSON OpLte = "lte"

instance FromJSON RuleOperator where
  parseJSON = withText "RuleOperator" $ \t -> case t of
    "gt" -> pure OpGt
    "gte" -> pure OpGte
    "lt" -> pure OpLt
    "lte" -> pure OpLte
    _ -> fail $ "Invalid RuleOperator: " <> T.unpack t

data ThresholdSource
  = ThHardwareLimit
  | ThUserDeviceOverride
  | ThGenericDefault
  | ThUnavailable
  deriving (Eq, Show)

instance ToJSON ThresholdSource where
  toJSON ThHardwareLimit = "hardware_limit"
  toJSON ThUserDeviceOverride = "user_device_override"
  toJSON ThGenericDefault = "generic_default"
  toJSON ThUnavailable = "unavailable"

instance FromJSON ThresholdSource where
  parseJSON = withText "ThresholdSource" $ \t -> case t of
    "hardware_limit" -> pure ThHardwareLimit
    "user_device_override" -> pure ThUserDeviceOverride
    "generic_default" -> pure ThGenericDefault
    "unavailable" -> pure ThUnavailable
    _ -> fail $ "Invalid ThresholdSource: " <> T.unpack t

data TrendDirection
  = TrendRising
  | TrendStable
  | TrendFalling
  | TrendInsufficientData
  deriving (Eq, Show)

instance ToJSON TrendDirection where
  toJSON TrendRising = "rising"
  toJSON TrendStable = "stable"
  toJSON TrendFalling = "falling"
  toJSON TrendInsufficientData = "insufficient_data"

instance FromJSON TrendDirection where
  parseJSON = withText "TrendDirection" $ \t -> case t of
    "rising" -> pure TrendRising
    "stable" -> pure TrendStable
    "falling" -> pure TrendFalling
    "insufficient_data" -> pure TrendInsufficientData
    _ -> fail $ "Invalid TrendDirection: " <> T.unpack t

data AlertStateName
  = AlertStateOk
  | AlertStatePending
  | AlertStateFiring
  | AlertStateResolved
  deriving (Eq, Show)

instance ToJSON AlertStateName where
  toJSON AlertStateOk = "ok"
  toJSON AlertStatePending = "pending"
  toJSON AlertStateFiring = "firing"
  toJSON AlertStateResolved = "resolved"

instance FromJSON AlertStateName where
  parseJSON = withText "AlertStateName" $ \t -> case t of
    "ok" -> pure AlertStateOk
    "pending" -> pure AlertStatePending
    "firing" -> pure AlertStateFiring
    "resolved" -> pure AlertStateResolved
    _ -> fail $ "Invalid AlertStateName: " <> T.unpack t

data AlertTransitionKind
  = TransitionNoop
  | TransitionTrigger
  | TransitionEscalate
  | TransitionResolve
  deriving (Eq, Show)

instance ToJSON AlertTransitionKind where
  toJSON TransitionNoop = "noop"
  toJSON TransitionTrigger = "trigger"
  toJSON TransitionEscalate = "escalate"
  toJSON TransitionResolve = "resolve"

instance FromJSON AlertTransitionKind where
  parseJSON = withText "AlertTransitionKind" $ \t -> case t of
    "noop" -> pure TransitionNoop
    "trigger" -> pure TransitionTrigger
    "escalate" -> pure TransitionEscalate
    "resolve" -> pure TransitionResolve
    _ -> fail $ "Invalid AlertTransitionKind: " <> T.unpack t

data AlertRuleSpec = AlertRuleSpec
  { ruleSpecId :: Text
  , ruleSpecMetric :: Text
  , ruleSpecDeviceType :: DeviceType
  , ruleSpecDeviceId :: Maybe Text
  , ruleSpecOperator :: RuleOperator
  , ruleSpecThreshold :: Double
  , ruleSpecUnit :: Unit
  , ruleSpecDurationSeconds :: Int
  , ruleSpecSeverity :: Severity
  , ruleSpecEnabled :: Bool
  }
  deriving (Eq, Show)

instance ToJSON AlertRuleSpec where
  toJSON r =
    object
      [ "rule_id" .= ruleSpecId r
      , "metric" .= ruleSpecMetric r
      , "device_type" .= ruleSpecDeviceType r
      , "device_id" .= ruleSpecDeviceId r
      , "operator" .= ruleSpecOperator r
      , "threshold" .= ruleSpecThreshold r
      , "unit" .= ruleSpecUnit r
      , "duration_seconds" .= ruleSpecDurationSeconds r
      , "severity" .= ruleSpecSeverity r
      , "enabled" .= ruleSpecEnabled r
      ]

instance FromJSON AlertRuleSpec where
  parseJSON = withObject "AlertRuleSpec" $ \o ->
    AlertRuleSpec
      <$> o .: "rule_id"
      <*> o .: "metric"
      <*> o .: "device_type"
      <*> o .:? "device_id"
      <*> o .: "operator"
      <*> o .: "threshold"
      <*> o .: "unit"
      <*> o .: "duration_seconds"
      <*> o .: "severity"
      <*> o .: "enabled"

data HardwareLimit = HardwareLimit
  { hwLimitDeviceId :: Text
  , hwLimitMetric :: Text
  , hwLimitUnit :: Unit
  , hwLimitMaxValue :: Maybe Double
  , hwLimitCritValue :: Maybe Double
  , hwLimitSource :: Text
  }
  deriving (Eq, Show)

instance ToJSON HardwareLimit where
  toJSON h =
    object
      [ "device_id" .= hwLimitDeviceId h
      , "metric" .= hwLimitMetric h
      , "unit" .= hwLimitUnit h
      , "max_value" .= hwLimitMaxValue h
      , "crit_value" .= hwLimitCritValue h
      , "source" .= hwLimitSource h
      ]

instance FromJSON HardwareLimit where
  parseJSON = withObject "HardwareLimit" $ \o ->
    HardwareLimit
      <$> o .: "device_id"
      <*> o .: "metric"
      <*> o .: "unit"
      <*> o .:? "max_value"
      <*> o .:? "crit_value"
      <*> o .: "source"

data AlertStateSnapshot = AlertStateSnapshot
  { snapStateKey :: Text
  , snapHostId :: Text
  , snapDeviceId :: Text
  , snapRuleId :: Text
  , snapState :: AlertStateName
  , snapPendingSince :: Maybe Text
  , snapFiringSince :: Maybe Text
  , snapLastEvaluatedAt :: Text
  }
  deriving (Eq, Show)

instance ToJSON AlertStateSnapshot where
  toJSON s =
    object
      [ "state_key" .= snapStateKey s
      , "host_id" .= snapHostId s
      , "device_id" .= snapDeviceId s
      , "rule_id" .= snapRuleId s
      , "state" .= snapState s
      , "pending_since" .= snapPendingSince s
      , "firing_since" .= snapFiringSince s
      , "last_evaluated_at" .= snapLastEvaluatedAt s
      ]

instance FromJSON AlertStateSnapshot where
  parseJSON = withObject "AlertStateSnapshot" $ \o ->
    AlertStateSnapshot
      <$> o .: "state_key"
      <*> o .: "host_id"
      <*> o .: "device_id"
      <*> o .: "rule_id"
      <*> o .: "state"
      <*> o .:? "pending_since"
      <*> o .:? "firing_since"
      <*> o .: "last_evaluated_at"

data AnalyzeDeviceRef = AnalyzeDeviceRef
  { refDeviceId :: Text
  , refDeviceType :: DeviceType
  , refDeviceStatus :: DeviceStatus
  }
  deriving (Eq, Show)

instance ToJSON AnalyzeDeviceRef where
  toJSON d =
    object
      [ "device_id" .= refDeviceId d
      , "device_type" .= refDeviceType d
      , "device_status" .= refDeviceStatus d
      ]

instance FromJSON AnalyzeDeviceRef where
  parseJSON = withObject "AnalyzeDeviceRef" $ \o ->
    AnalyzeDeviceRef
      <$> o .: "device_id"
      <*> o .: "device_type"
      <*> o .: "device_status"

data HistoryPoint = HistoryPoint
  { hpDeviceId :: Text
  , hpSensorId :: Text
  , hpMetric :: Text
  , hpValue :: Maybe Double
  , hpQuality :: ReadingQuality
  , hpCollectedAt :: Text
  }
  deriving (Eq, Show)

instance ToJSON HistoryPoint where
  toJSON h =
    object
      [ "device_id" .= hpDeviceId h
      , "sensor_id" .= hpSensorId h
      , "metric" .= hpMetric h
      , "value" .= hpValue h
      , "quality" .= hpQuality h
      , "collected_at" .= hpCollectedAt h
      ]

instance FromJSON HistoryPoint where
  parseJSON = withObject "HistoryPoint" $ \o ->
    HistoryPoint
      <$> o .: "device_id"
      <*> o .: "sensor_id"
      <*> o .: "metric"
      <*> o .: "value"
      <*> o .: "quality"
      <*> o .: "collected_at"

data AnalyzeRequest = AnalyzeRequest
  { reqSchemaVersion :: Text
  , reqHostId :: Text
  , reqEvaluatedAt :: Text
  , reqRuleVersion :: Text
  , reqDevices :: [AnalyzeDeviceRef]
  , reqReadings :: [SensorReading]
  , reqHistoryPoints :: [HistoryPoint]
  , reqRules :: [AlertRuleSpec]
  , reqHardwareLimits :: [HardwareLimit]
  , reqPrevAlertStates :: [AlertStateSnapshot]
  }
  deriving (Eq, Show)

instance ToJSON AnalyzeRequest where
  toJSON r =
    object
      [ "schema_version" .= reqSchemaVersion r
      , "host_id" .= reqHostId r
      , "evaluated_at" .= reqEvaluatedAt r
      , "rule_version" .= reqRuleVersion r
      , "devices" .= reqDevices r
      , "readings" .= reqReadings r
      , "history_points" .= reqHistoryPoints r
      , "rules" .= reqRules r
      , "hardware_limits" .= reqHardwareLimits r
      , "prev_alert_states" .= reqPrevAlertStates r
      ]

instance FromJSON AnalyzeRequest where
  parseJSON = withObject "AnalyzeRequest" $ \o ->
    AnalyzeRequest
      <$> o .: "schema_version"
      <*> o .: "host_id"
      <*> o .: "evaluated_at"
      <*> o .: "rule_version"
      <*> o .: "devices"
      <*> o .: "readings"
      <*> o .: "history_points"
      <*> o .: "rules"
      <*> o .: "hardware_limits"
      <*> o .: "prev_alert_states"

data AnomalyRecord = AnomalyRecord
  { anomalyRecCode :: Text
  , anomalyRecReason :: Text
  }
  deriving (Eq, Show)

instance ToJSON AnomalyRecord where
  toJSON a = object ["code" .= anomalyRecCode a, "reason" .= anomalyRecReason a]

instance FromJSON AnomalyRecord where
  parseJSON = withObject "AnomalyRecord" $ \o ->
    AnomalyRecord <$> o .: "code" <*> o .: "reason"

data CorrelationRecord = CorrelationRecord
  { corrRecCode :: Text
  , corrRecSummary :: Text
  }
  deriving (Eq, Show)

instance ToJSON CorrelationRecord where
  toJSON c = object ["code" .= corrRecCode c, "summary" .= corrRecSummary c]

instance FromJSON CorrelationRecord where
  parseJSON = withObject "CorrelationRecord" $ \o ->
    CorrelationRecord <$> o .: "code" <*> o .: "summary"

data ScoreFactorRecord = ScoreFactorRecord
  { factorRecMetric :: Text
  , factorRecDelta :: Double
  , factorRecReason :: Text
  }
  deriving (Eq, Show)

instance ToJSON ScoreFactorRecord where
  toJSON f =
    object
      [ "metric" .= factorRecMetric f
      , "delta" .= factorRecDelta f
      , "reason" .= factorRecReason f
      ]

instance FromJSON ScoreFactorRecord where
  parseJSON = withObject "ScoreFactorRecord" $ \o ->
    ScoreFactorRecord <$> o .: "metric" <*> o .: "delta" <*> o .: "reason"

data AnalysisResultRecord = AnalysisResultRecord
  { resHostId :: Text
  , resDeviceId :: Text
  , resSeverity :: Severity
  , resScore :: Maybe Double
  , resEngineVersion :: Text
  , resRuleVersion :: Text
  , resThresholdSource :: ThresholdSource
  , resTrend :: TrendDirection
  , resAnomalies :: [AnomalyRecord]
  , resCorrelations :: [CorrelationRecord]
  , resFactors :: [ScoreFactorRecord]
  , resAnalyzedAt :: Text
  }
  deriving (Eq, Show)

instance ToJSON AnalysisResultRecord where
  toJSON a =
    object
      [ "host_id" .= resHostId a
      , "device_id" .= resDeviceId a
      , "severity" .= resSeverity a
      , "score" .= resScore a
      , "engine_version" .= resEngineVersion a
      , "rule_version" .= resRuleVersion a
      , "threshold_source" .= resThresholdSource a
      , "trend" .= resTrend a
      , "anomalies" .= resAnomalies a
      , "correlations" .= resCorrelations a
      , "factors" .= resFactors a
      , "analyzed_at" .= resAnalyzedAt a
      ]

instance FromJSON AnalysisResultRecord where
  parseJSON = withObject "AnalysisResultRecord" $ \o ->
    AnalysisResultRecord
      <$> o .: "host_id"
      <*> o .: "device_id"
      <*> o .: "severity"
      <*> o .: "score"
      <*> o .: "engine_version"
      <*> o .: "rule_version"
      <*> o .: "threshold_source"
      <*> o .: "trend"
      <*> o .: "anomalies"
      <*> o .: "correlations"
      <*> o .: "factors"
      <*> o .: "analyzed_at"

data AlertTransitionRecord = AlertTransitionRecord
  { transStateKey :: Text
  , transHostId :: Text
  , transDeviceId :: Text
  , transRuleId :: Text
  , transKind :: AlertTransitionKind
  , transSeverity :: Severity
  , transSummary :: Text
  , transMetric :: Text
  , transObservedValue :: Maybe Double
  , transThreshold :: Double
  , transThresholdSource :: ThresholdSource
  }
  deriving (Eq, Show)

instance ToJSON AlertTransitionRecord where
  toJSON t =
    object
      [ "state_key" .= transStateKey t
      , "host_id" .= transHostId t
      , "device_id" .= transDeviceId t
      , "rule_id" .= transRuleId t
      , "transition" .= transKind t
      , "severity" .= transSeverity t
      , "summary" .= transSummary t
      , "metric" .= transMetric t
      , "observed_value" .= transObservedValue t
      , "threshold" .= transThreshold t
      , "threshold_source" .= transThresholdSource t
      ]

instance FromJSON AlertTransitionRecord where
  parseJSON = withObject "AlertTransitionRecord" $ \o ->
    AlertTransitionRecord
      <$> o .: "state_key"
      <*> o .: "host_id"
      <*> o .: "device_id"
      <*> o .: "rule_id"
      <*> o .: "transition"
      <*> o .: "severity"
      <*> o .: "summary"
      <*> o .: "metric"
      <*> o .: "observed_value"
      <*> o .: "threshold"
      <*> o .: "threshold_source"

data AnalyzeResponse = AnalyzeResponse
  { respSchemaVersion :: Text
  , respEngineVersion :: Text
  , respRuleVersion :: Text
  , respAnalyzedAt :: Text
  , respAnalysisResults :: [AnalysisResultRecord]
  , respAlertTransitions :: [AlertTransitionRecord]
  , respNextAlertStates :: [AlertStateSnapshot]
  }
  deriving (Eq, Show)

instance ToJSON AnalyzeResponse where
  toJSON r =
    object
      [ "schema_version" .= respSchemaVersion r
      , "engine_version" .= respEngineVersion r
      , "rule_version" .= respRuleVersion r
      , "analyzed_at" .= respAnalyzedAt r
      , "analysis_results" .= respAnalysisResults r
      , "alert_transitions" .= respAlertTransitions r
      , "next_alert_states" .= respNextAlertStates r
      ]

instance FromJSON AnalyzeResponse where
  parseJSON = withObject "AnalyzeResponse" $ \o ->
    AnalyzeResponse
      <$> o .: "schema_version"
      <*> o .: "engine_version"
      <*> o .: "rule_version"
      <*> o .: "analyzed_at"
      <*> o .: "analysis_results"
      <*> o .: "alert_transitions"
      <*> o .: "next_alert_states"
