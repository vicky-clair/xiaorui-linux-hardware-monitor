import { IPC_MAX_FRAME_BYTES } from "./types.ts";

export class FrameError extends Error {
  constructor(
    public readonly code: "FRAME_TOO_LARGE" | "EMPTY_FRAME" | "INVALID_UTF8",
    message: string,
  ) {
    super(message);
    this.name = "FrameError";
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Encodes a JSON-serializable message into a 4-byte big-endian length-prefixed frame (ADR-0003).
 */
export function encodeFrame(payload: unknown): Uint8Array {
  const jsonBytes = textEncoder.encode(JSON.stringify(payload));
  if (jsonBytes.byteLength === 0) {
    throw new FrameError("EMPTY_FRAME", "Frame payload must not be empty");
  }
  if (jsonBytes.byteLength > IPC_MAX_FRAME_BYTES) {
    throw new FrameError(
      "FRAME_TOO_LARGE",
      `Frame size ${jsonBytes.byteLength} exceeds max ${IPC_MAX_FRAME_BYTES} bytes`,
    );
  }
  const frame = new Uint8Array(4 + jsonBytes.byteLength);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(0, jsonBytes.byteLength, false);
  frame.set(jsonBytes, 4);
  return frame;
}

/**
 * Incremental decoder for 4-byte big-endian length-prefixed UTF-8 JSON frames.
 * Handles partial reads and coalesced frames without assuming one read == one message.
 */
export class FrameDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): string[] {
    if (chunk.byteLength === 0) {
      return [];
    }
    const combined = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.byteLength);
    this.buffer = combined;

    const frames: string[] = [];
    let offset = 0;

    while (this.buffer.byteLength - offset >= 4) {
      const view = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset + offset,
        4,
      );
      const length = view.getUint32(0, false);

      if (length === 0) {
        this.buffer = new Uint8Array(0);
        throw new FrameError("EMPTY_FRAME", "Received zero-length IPC frame");
      }
      if (length > IPC_MAX_FRAME_BYTES) {
        this.buffer = new Uint8Array(0);
        throw new FrameError(
          "FRAME_TOO_LARGE",
          `Declared frame size ${length} exceeds max ${IPC_MAX_FRAME_BYTES} bytes`,
        );
      }

      if (this.buffer.byteLength - offset < 4 + length) {
        break;
      }

      const slice = this.buffer.subarray(offset + 4, offset + 4 + length);
      try {
        frames.push(textDecoder.decode(slice));
      } catch {
        this.buffer = new Uint8Array(0);
        throw new FrameError("INVALID_UTF8", "IPC frame is not valid UTF-8");
      }
      offset += 4 + length;
    }

    if (offset > 0) {
      this.buffer = this.buffer.slice(offset);
    }
    return frames;
  }

  pendingBytes(): number {
    return this.buffer.byteLength;
  }
}
