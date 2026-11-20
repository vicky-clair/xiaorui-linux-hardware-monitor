import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProtocolValidator,
  encodeFrame,
  FrameDecoder,
  FrameError,
  IPC_MAX_FRAME_BYTES,
  type SchemaName,
  type SmartReport,
} from "../src/index.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = resolve(currentDir, "../../examples");
const validator = createProtocolValidator();

function loadExample(subpath: string): unknown {
  return JSON.parse(readFileSync(resolve(EXAMPLES_DIR, subpath), "utf8"));
}

describe("JSON Schema golden valid fixtures", () => {
  const validCases: Array<[SchemaName, string]> = [
    ["host", "valid/host.json"],
    ["device", "valid/device.json"],
    ["sensor", "valid/sensor.json"],
    ["sensor-reading", "valid/sensor-reading-valid.json"],
    ["sensor-reading", "valid/sensor-reading-zero.json"],
    ["sensor-reading", "valid/sensor-reading-missing.json"],
    ["collector-status", "valid/collector-status.json"],
    ["diagnostic", "valid/diagnostic.json"],
    ["smart-report", "valid/smart-report-standby.json"],
    ["smart-report", "valid/smart-report-nvme-bigint.json"],
    ["ipc-message", "valid/ipc-hello.json"],
    ["ipc-message", "valid/ipc-sensor-readings.json"],
    ["analyze-request", "valid/analyze-request.json"],
    ["analyze-response", "valid/analyze-response.json"],
  ];

  for (const [schema, file] of validCases) {
    test(`accepts ${file} against ${schema}`, () => {
      const data = loadExample(file);
      const res = validator.validate(schema, data);
      expect(res.errors).toEqual([]);
      expect(res.valid).toBe(true);
    });
  }

  test("preserves 128-bit NVMe counters as exact decimal strings without precision loss", () => {
    const report = loadExample("valid/smart-report-nvme-bigint.json") as SmartReport;
    expect(report.data_units_read).toBe("340282366920938463463374607431768211455");
    expect(report.attributes[0]?.raw_value).toBe("9007199254740993");
    expect(BigInt(report.data_units_read!)).toBe(
      340282366920938463463374607431768211455n,
    );
  });
});

describe("JSON Schema golden invalid fixtures", () => {
  const invalidCases: Array<[SchemaName, string]> = [
    ["sensor-reading", "invalid/sensor-reading-missing-with-zero.json"],
    ["sensor-reading", "invalid/sensor-reading-valid-with-null.json"],
    ["sensor-reading", "invalid/sensor-reading-bad-quality.json"],
    ["smart-report", "invalid/smart-report-non-digit-bigint.json"],
    ["ipc-message", "invalid/ipc-wrong-protocol.json"],
  ];

  for (const [schema, file] of invalidCases) {
    test(`rejects ${file} against ${schema}`, () => {
      const data = loadExample(file);
      const res = validator.validate(schema, data);
      expect(res.valid).toBe(false);
    });
  }
});

describe("IPC 4-byte BE length-prefixed framing (ADR-0003)", () => {
  test("handles partial chunks and coalesced frames", () => {
    const msg1 = loadExample("valid/ipc-hello.json");
    const msg2 = loadExample("valid/ipc-sensor-readings.json");
    const f1 = encodeFrame(msg1);
    const f2 = encodeFrame(msg2);

    const stream = new Uint8Array(f1.byteLength + f2.byteLength);
    stream.set(f1, 0);
    stream.set(f2, f1.byteLength);

    const decoder = new FrameDecoder();
    const out: string[] = [];
    // Feed in awkward small chunks (1, 2, 7 bytes) to simulate arbitrary socket reads
    for (let i = 0; i < stream.byteLength; ) {
      const step = (i % 7) + 1;
      out.push(...decoder.push(stream.subarray(i, i + step)));
      i += step;
    }

    expect(decoder.pendingBytes()).toBe(0);
    expect(out.length).toBe(2);
    expect(JSON.parse(out[0]!)).toEqual(msg1);
    expect(JSON.parse(out[1]!)).toEqual(msg2);
  });

  test("rejects frames exceeding 1 MiB limit", () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, IPC_MAX_FRAME_BYTES + 1, false);
    const decoder = new FrameDecoder();
    expect(() => decoder.push(header)).toThrow(FrameError);
  });
});
