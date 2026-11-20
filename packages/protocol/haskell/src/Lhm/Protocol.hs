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
