import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeFrame,
  FrameDecoder,
  type IpcMessage,
  PROTOCOL_NAME,
  SCHEMA_VERSION,
} from "@lhm/protocol";
import { createAppRuntime } from "../src/app.ts";
import { IpcStreamSession } from "../src/ipc/unixServer.ts";

function makeMsg(
  agentInstanceId: string,
  sequence: number,
  message_type: IpcMessage["message_type"],
  payload: Record<string, unknown>,
  schema_version: string = SCHEMA_VERSION,
): IpcMessage {
  return {
    protocol: PROTOCOL_NAME,
    schema_version,
    message_id: crypto.randomUUID(),
    message_type,
    host_id: "host-test-01",
    agent_instance_id: agentInstanceId,
    sequence,
    sent_at: "2026-11-20T10:00:00Z",
    payload,
  } as IpcMessage;
}

function sendAndDecode(session: IpcStreamSession, msg: IpcMessage): IpcMessage {
  const wire = encodeFrame(msg);
  // Feed in 2 awkward slices to verify partial-read handling
  const split = Math.max(1, Math.floor(wire.byteLength / 3));
  const out = [
    ...session.onChunk(wire.subarray(0, split)),
    ...session.onChunk(wire.subarray(split)),
  ];
  expect(out.length).toBe(1);
  const dec = new FrameDecoder();
  const decoded = dec.push(out[0]!);
  expect(decoded.length).toBe(1);
  return JSON.parse(decoded[0]!) as IpcMessage;
}

describe("IPC ingestion, deduplication, persistence, aggregation & retention", () => {
  test("validates schema, deduplicates (agent_instance_id, sequence), and handles restart", () => {
    const rt = createAppRuntime({ dbPath: ":memory:" });
    try {
      const session = new IpcStreamSession(rt.ipcProcessor);

      // 1. Incompatible major schema version rejected in hello_ack
      const badHello = sendAndDecode(
        session,
        makeMsg(
          "inst-bad",
          0,
          "hello",
          {
            host: {
              host_id: "host-test-01",
              hostname: "debian-srv",
              os_name: "Debian GNU/Linux",
              os_version: "13.6",
              kernel_version: "6.12.107+deb13-amd64",
              architecture: "x86_64",
              agent_version: "0.1.0",
            },
          },
          "2.0",
        ),
      );
      expect(badHello.message_type).toBe("hello_ack");
      expect((badHello.payload as { accepted: boolean }).accepted).toBe(false);

      // 2. Valid hello accepted
      const helloReply = sendAndDecode(
        session,
        makeMsg("inst-1", 0, "hello", {
          host: {
            host_id: "host-test-01",
            hostname: "debian-srv",
            os_name: "Debian GNU/Linux",
            os_version: "13.6",
            kernel_version: "6.12.107+deb13-amd64",
            architecture: "x86_64",
            agent_version: "0.1.0",
            uptime_seconds: 5000,
          },
        }),
      );
      expect(helloReply.message_type).toBe("hello_ack");
      expect((helloReply.payload as { accepted: boolean }).accepted).toBe(true);

      // 3. Inventory seq=1
      const invReply = sendAndDecode(
        session,
        makeMsg("inst-1", 1, "inventory", {
          devices: [
            {
              device_id: "gpu-pci-0000-00-02-0",
              host_id: "host-test-01",
              device_type: "gpu",
              vendor: "intel",
              model: "8086:4e55",
              name: "Intel GPU",
              identity: { stable: true, pci_bus_id: "0000:00:02.0" },
              capabilities: ["frequency"],
              device_status: "online",
            },
          ],
          sensors: [
            {
              sensor_id: "gpu-pci-0000-00-02-0-freq-act",
              device_id: "gpu-pci-0000-00-02-0",
              sensor_type: "frequency",
              sensor_name: "GPU Actual Frequency",
              source: "drm-intel",
              unit: "hertz",
              capability_status: "supported",
              enabled: true,
            },
          ],
        }),
      );
      expect(invReply.message_type).toBe("ack");

      // 4. Readings seq=2 (0.0 Hz valid + null missing)
      const readingMsg = makeMsg("inst-1", 2, "sensor_readings", {
        readings: [
          {
            schema_version: "1.0",
            host_id: "host-test-01",
            device_id: "gpu-pci-0000-00-02-0",
            sensor_id: "gpu-pci-0000-00-02-0-freq-act",
            metric: "gpu_freq_actual",
            value: 0,
            unit: "hertz",
            quality: "valid",
            source: "drm-intel",
            collected_at: "2026-11-20T10:00:00Z",
          },
        ],
      });
      const r1 = sendAndDecode(session, readingMsg);
      expect(r1.message_type).toBe("ack");
      // Replay exact same seq=2 -> idempotent ACK, MUST NOT insert duplicate row!
      const rDup = sendAndDecode(session, readingMsg);
      expect(rDup.message_type).toBe("ack");

      const firstQuery = rt.telemetryRepo.querySensorReadings({
        sensorId: "gpu-pci-0000-00-02-0-freq-act",
      });
      expect(firstQuery.items.length).toBe(1);

      // 5. Agent restarts with NEW agent_instance_id ("inst-2") and seq=1 -> MUST BE ACCEPTED!
      const afterRestart = sendAndDecode(
        session,
        makeMsg("inst-2", 1, "sensor_readings", {
          readings: [
            {
              schema_version: "1.0",
              host_id: "host-test-01",
              device_id: "gpu-pci-0000-00-02-0",
              sensor_id: "gpu-pci-0000-00-02-0-freq-act",
              metric: "gpu_freq_actual",
              value: 200000000,
              unit: "hertz",
              quality: "valid",
              source: "drm-intel",
              collected_at: "2026-11-20T10:00:30Z",
            },
          ],
        }),
      );
      expect(afterRestart.message_type).toBe("ack");
      const secondQuery = rt.telemetryRepo.querySensorReadings({
        sensorId: "gpu-pci-0000-00-02-0-freq-act",
      });
      expect(secondQuery.items.length).toBe(2);

      // 6. SMART report with 128-bit NVMe counter string
      const smartReply = sendAndDecode(
        session,
        makeMsg("inst-2", 2, "smart_report", {
          report: {
            schema_version: "1.0",
            host_id: "host-test-01",
            device_id: "disk-nvme-0000-02-00-0",
            device_path: "/dev/nvme0n1",
            protocol_type: "nvme",
            device_status: "online",
            smart_passed: true,
            temperature_celsius: 39,
            data_units_read: "340282366920938463463374607431768211455",
            attributes: [
              {
                id: 5,
                name: "Reallocated_Sector_Ct",
                value: 100,
                worst: 100,
                threshold: 10,
                raw_value: "9007199254740993",
                raw_string: "9007199254740993",
              },
            ],
            collected_at: "2026-11-20T10:01:00Z",
          },
        }),
      );
      expect(smartReply.message_type).toBe("ack");
      const smartDetail = rt.telemetryRepo.getStorageSmart("disk-nvme-0000-02-00-0");
      expect(smartDetail?.latest?.dataUnitsRead).toBe(
        "340282366920938463463374607431768211455",
      );
      expect(smartDetail?.latest?.attributes[0]?.rawValue).toBe("9007199254740993");

      // 7. Coverage stale detection (now = 10:05:00Z, stale threshold 60s -> stale!)
      const cov = rt.telemetryRepo.getCoverage(60, Date.parse("2026-11-20T10:05:00Z"));
      const gpuCov = cov.devices.find((d) => d.device_id === "gpu-pci-0000-00-02-0");
      expect(gpuCov?.stale_metrics).toContain("GPU Actual Frequency");
    } finally {
      rt.close();
    }
  });

  test("persists data across SQLite close & reopen and runs re-entrant 1m/1h aggregation + retention", () => {
    const dbPath = join(tmpdir(), `lhm-test-${crypto.randomUUID()}.sqlite`);
    try {
      const rt1 = createAppRuntime({ dbPath });
      rt1.telemetryRepo.insertReadingsBatch("host-test-01", [
        {
          schema_version: "1.0",
          host_id: "host-test-01",
          device_id: "cpu-system-0",
          sensor_id: "cpu-system-0-temp-pkg",
          metric: "temperature",
          value: 50,
          unit: "celsius",
          quality: "valid",
          source: "hwmon",
          collected_at: "2026-10-01T10:00:10Z",
        },
        {
          schema_version: "1.0",
          host_id: "host-test-01",
          device_id: "cpu-system-0",
          sensor_id: "cpu-system-0-temp-pkg",
          metric: "temperature",
          value: 60,
          unit: "celsius",
          quality: "valid",
          source: "hwmon",
          collected_at: "2026-10-01T10:00:40Z",
        },
        {
          schema_version: "1.0",
          host_id: "host-test-01",
          device_id: "cpu-system-0",
          sensor_id: "cpu-system-0-temp-pkg",
          metric: "temperature",
          value: null,
          unit: "celsius",
          quality: "missing",
          source: "hwmon",
          collected_at: "2026-10-01T10:00:50Z",
        },
      ]);
      rt1.close();

      // Reopen DB (simulating API service restart)
      const rt2 = createAppRuntime({ dbPath });
      try {
        const rawBefore = rt2.telemetryRepo.querySensorReadings({
          sensorId: "cpu-system-0-temp-pkg",
        });
        expect(rawBefore.items.length).toBe(3);

        // Prune BEFORE aggregation -> MUST NOT delete unaggregated raw readings!
        const beforeAggPrune = rt2.aggregationRepo.pruneExpired(
          { rawDays: 14, agg1mDays: 90, agg1hDays: 365, smartDays: 365 },
          Date.parse("2026-11-20T00:00:00Z"),
        );
        expect(beforeAggPrune.rawDeleted).toBe(0);

        // Run 1m + 1h aggregation twice (verify re-entrancy)
        rt2.aggregationRepo.aggregate1m("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z");
        rt2.aggregationRepo.aggregate1m("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z");
        rt2.aggregationRepo.aggregate1h("2026-10-01T10:00:00Z", "2026-10-01T11:00:00Z");

        const agg1m = rt2.telemetryRepo.querySensorReadings({
          sensorId: "cpu-system-0-temp-pkg",
          granularity: "1m",
        });
        expect(agg1m.items.length).toBe(1);
        expect((agg1m.items[0] as { minValue: number; maxValue: number; avgValue: number; sampleCount: number; validCount: number })).toMatchObject({
          minValue: 50,
          maxValue: 60,
          avgValue: 55,
          sampleCount: 3,
          validCount: 2,
        });

        // Now prune AFTER aggregation -> old raw readings cleanly deleted, 1m/1h retained!
        const afterAggPrune = rt2.aggregationRepo.pruneExpired(
          { rawDays: 14, agg1mDays: 90, agg1hDays: 365, smartDays: 365 },
          Date.parse("2026-11-20T00:00:00Z"),
        );
        expect(afterAggPrune.rawDeleted).toBe(3);
        expect(afterAggPrune.agg1mDeleted).toBe(0);
      } finally {
        rt2.close();
      }
    } finally {
      for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        try {
          rmSync(p, { force: true });
        } catch {
          // Windows may hold transient WAL file handles briefly after close
        }
      }
    }
  });
});
