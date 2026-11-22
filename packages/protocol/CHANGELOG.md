# Protocol Changelog

All notable changes to the Linux Hardware Monitor shared protocol (`packages/protocol`) are documented in this file.

## [1.2] - 2026-11-22

### Added
- Backward-compatible optional fields on `schemas/smart-report.schema.json` (synced across TypeScript, Rust, and Haskell):
  - Drive operational metadata & self-test summary: `firmware_version`, `serial_number`, `rotation_rate_rpm`, `sata_link_speed`, `apm_level`, `write_cache_enabled`, `trim_supported`, `self_test_passed`, `self_test_last_status`, `self_test_last_hours`, `error_log_count`.
  - Extended NVMe health fields: `media_errors`, `num_err_log_entries`, `unsafe_shutdowns`, `warning_temp_time_min`, `critical_comp_time_min`, `temperature_sensors_celsius`.

## [1.1] - 2026-11-20

### Added
- Backward-compatible `schemas/analyze.schema.json` defining `AnalyzeRequest` and `AnalyzeResponse` for the Bun API ↔ Haskell Health Engine stateless HTTP JSON interface (ADR-0004, ADR-0007).
- Golden fixtures `examples/valid/analyze-request.json` and `examples/valid/analyze-response.json` validated across TypeScript (Ajv), Rust (`serde`), and Haskell (`aeson`).

## [1.0] - 2026-11-20

### Added
- Initial JSON Schema (Draft 2020-12) definitions under `schemas/`:
  - `common.schema.json`: four independent status dimensions (`CapabilityStatus`, `ReadingQuality`, `DeviceStatus`, `Severity`), `Unit`, `DeviceType`, `SensorType`, `UtcTimestamp`, `UintString` (decimal string for integers > 2^53), `StableId`.
  - `host.schema.json`, `device.schema.json`, `sensor.schema.json`, `sensor-reading.schema.json`, `collector-status.schema.json`, `diagnostic.schema.json`, `smart-report.schema.json`.
  - `ipc-message.schema.json`: `lhm-ipc` v1.0 envelope and message payloads (`hello`, `hello_ack`, `heartbeat`, `ack`, `inventory`, `sensor_readings`, `smart_report`, `collector_status`, `diagnostic`, `error`) with 4-byte big-endian length-prefixed framing (ADR-0003).
- Cross-language bindings and golden fixture tests in TypeScript (Ajv), Rust (`serde`), and Haskell (`aeson`) per ADR-0005.
