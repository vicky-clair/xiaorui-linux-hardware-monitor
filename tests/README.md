# Tests Directory

- `protocol/`: Cross-language protocol conformance notes (golden fixtures live in `packages/protocol/examples/`).
- `fixtures/`: Sanitized sample outputs from real hardware (`sysfs`, `smartctl --json`, `nvme -o json`).
- `hardware-simulation/`: Mock sysfs / hwmon / thermal / command fixtures for deterministic offline testing.
- `integration/`: End-to-end tests across Agent, IPC, Bun API, SQLite, and Haskell engine.

All simulated data MUST be explicitly marked as test data and never reported as real hardware validation.
