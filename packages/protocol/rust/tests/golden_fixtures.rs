use lhm_protocol::{
    CollectorStatus, Device, Diagnostic, FrameDecoder, Host, IPC_MAX_FRAME_BYTES, IpcMessage,
    ProtocolError, Sensor, SensorReading, SmartReport, encode_frame,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::fs;
use std::path::PathBuf;

fn example_path(subpath: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("examples")
        .join(subpath)
}

fn assert_valid_roundtrip<T>(subpath: &str) -> T
where
    T: DeserializeOwned + Serialize + PartialEq + std::fmt::Debug,
{
    let raw = fs::read_to_string(example_path(subpath))
        .unwrap_or_else(|e| panic!("failed to read fixture {subpath}: {e}"));
    let parsed: T = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("failed to parse valid fixture {subpath}: {e}"));
    let reencoded = serde_json::to_string(&parsed).expect("serialize failed");
    let reparsed: T = serde_json::from_str(&reencoded).expect("reparse failed");
    assert_eq!(parsed, reparsed, "roundtrip mismatch for {subpath}");
    parsed
}

fn assert_invalid<T: DeserializeOwned + std::fmt::Debug>(subpath: &str) {
    let raw = fs::read_to_string(example_path(subpath))
        .unwrap_or_else(|e| panic!("failed to read invalid fixture {subpath}: {e}"));
    let result = serde_json::from_str::<T>(&raw);
    assert!(
        result.is_err(),
        "expected invalid fixture {subpath} to fail deserialization, got {result:?}"
    );
}

#[test]
fn valid_golden_fixtures_roundtrip() {
    assert_valid_roundtrip::<Host>("valid/host.json");
    assert_valid_roundtrip::<Device>("valid/device.json");
    assert_valid_roundtrip::<Sensor>("valid/sensor.json");
    assert_valid_roundtrip::<SensorReading>("valid/sensor-reading-valid.json");
    let zero = assert_valid_roundtrip::<SensorReading>("valid/sensor-reading-zero.json");
    assert_eq!(zero.value, Some(0.0));
    let missing = assert_valid_roundtrip::<SensorReading>("valid/sensor-reading-missing.json");
    assert_eq!(missing.value, None);
    assert_valid_roundtrip::<CollectorStatus>("valid/collector-status.json");
    assert_valid_roundtrip::<Diagnostic>("valid/diagnostic.json");
    assert_valid_roundtrip::<SmartReport>("valid/smart-report-standby.json");
    let nvme = assert_valid_roundtrip::<SmartReport>("valid/smart-report-nvme-bigint.json");
    assert_eq!(
        nvme.data_units_read.as_ref().map(|v| v.as_str()),
        Some("340282366920938463463374607431768211455")
    );
    assert_valid_roundtrip::<IpcMessage>("valid/ipc-hello.json");
    assert_valid_roundtrip::<IpcMessage>("valid/ipc-sensor-readings.json");
}

#[test]
fn invalid_golden_fixtures_rejected() {
    assert_invalid::<SensorReading>("invalid/sensor-reading-missing-with-zero.json");
    assert_invalid::<SensorReading>("invalid/sensor-reading-valid-with-null.json");
    assert_invalid::<SensorReading>("invalid/sensor-reading-bad-quality.json");
    assert_invalid::<SmartReport>("invalid/smart-report-non-digit-bigint.json");
    assert_invalid::<IpcMessage>("invalid/ipc-wrong-protocol.json");
}

#[test]
fn ipc_framing_handles_partial_and_coalesced_reads() {
    let m1 = assert_valid_roundtrip::<IpcMessage>("valid/ipc-hello.json");
    let m2 = assert_valid_roundtrip::<IpcMessage>("valid/ipc-sensor-readings.json");

    let mut wire = encode_frame(&m1).expect("encode m1");
    wire.extend_from_slice(&encode_frame(&m2).expect("encode m2"));

    let mut decoder = FrameDecoder::new();
    let mut frames = Vec::new();
    let mut idx = 0;
    while idx < wire.len() {
        let step = (idx % 7) + 1;
        let end = (idx + step).min(wire.len());
        frames.extend(decoder.push(&wire[idx..end]).expect("decode chunk"));
        idx = end;
    }

    assert_eq!(decoder.pending_bytes(), 0);
    assert_eq!(frames.len(), 2);
    assert_eq!(serde_json::from_str::<IpcMessage>(&frames[0]).unwrap(), m1);
    assert_eq!(serde_json::from_str::<IpcMessage>(&frames[1]).unwrap(), m2);
}

#[test]
fn ipc_framing_rejects_oversized_frame() {
    let mut decoder = FrameDecoder::new();
    let too_big = ((IPC_MAX_FRAME_BYTES + 1) as u32).to_be_bytes();
    let err = decoder.push(&too_big).unwrap_err();
    assert!(matches!(err, ProtocolError::FrameTooLarge { .. }));
}
