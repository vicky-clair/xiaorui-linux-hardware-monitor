import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

export type SchemaName =
  | "host"
  | "device"
  | "sensor"
  | "sensor-reading"
  | "collector-status"
  | "diagnostic"
  | "smart-report"
  | "ipc-message"
  | "analyze-request"
  | "analyze-response";

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

const SCHEMA_FILES: readonly string[] = [
  "common.schema.json",
  "host.schema.json",
  "device.schema.json",
  "sensor.schema.json",
  "sensor-reading.schema.json",
  "collector-status.schema.json",
  "diagnostic.schema.json",
  "smart-report.schema.json",
  "ipc-message.schema.json",
  "analyze.schema.json",
];

const SCHEMA_IDS: Record<SchemaName, string> = {
  host: "https://lhm.local/schemas/v1/host.schema.json",
  device: "https://lhm.local/schemas/v1/device.schema.json",
  sensor: "https://lhm.local/schemas/v1/sensor.schema.json",
  "sensor-reading": "https://lhm.local/schemas/v1/sensor-reading.schema.json",
  "collector-status": "https://lhm.local/schemas/v1/collector-status.schema.json",
  diagnostic: "https://lhm.local/schemas/v1/diagnostic.schema.json",
  "smart-report": "https://lhm.local/schemas/v1/smart-report.schema.json",
  "ipc-message": "https://lhm.local/schemas/v1/ipc-message.schema.json",
  "analyze-request": "https://lhm.local/schemas/v1/analyze.schema.json#/$defs/AnalyzeRequest",
  "analyze-response": "https://lhm.local/schemas/v1/analyze.schema.json#/$defs/AnalyzeResponse",
};

const currentDir = dirname(fileURLToPath(import.meta.url));
export const SCHEMAS_DIR = resolve(currentDir, "../../schemas");

export function createProtocolValidator(schemasDir: string = SCHEMAS_DIR) {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
  });
  addFormats(ajv);

  for (const filename of SCHEMA_FILES) {
    const raw = readFileSync(resolve(schemasDir, filename), "utf8");
    ajv.addSchema(JSON.parse(raw));
  }

  const compiled = new Map<SchemaName, ValidateFunction>();
  for (const [name, id] of Object.entries(SCHEMA_IDS) as [SchemaName, string][]) {
    const fn = ajv.getSchema(id);
    if (!fn) {
      throw new Error(`Failed to compile schema: ${name} (${id})`);
    }
    compiled.set(name, fn);
  }

  return {
    validate(schema: SchemaName, data: unknown): ValidationResult {
      const fn = compiled.get(schema);
      if (!fn) {
        throw new Error(`Unknown schema: ${schema}`);
      }
      const valid = Boolean(fn(data));
      return {
        valid,
        errors: fn.errors ? [...fn.errors] : [],
      };
    },
  };
}
