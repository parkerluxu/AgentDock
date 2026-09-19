import type { AdapterErrorCode } from "./errors.js";
import { normalizeAdapterError } from "./errors.js";
import type { AdapterManifest } from "../adapter-contract/index.js";
import { validateAdapterManifest } from "../adapter-contract/index.js";
import type { RunEvent } from "../core/types.js";

export * from "../adapter-contract/index.js";
export * from "./errors.js";
export * from "./testing.js";

export const ADAPTER_SDK_VERSION = "0.1.0" as const;

export function defineAdapterManifest(manifest: AdapterManifest): AdapterManifest {
  return validateAdapterManifest(manifest);
}

export interface AdapterEventOptions {
  runId: string;
  sequence: number;
  type: RunEvent["type"];
  payload: Record<string, unknown>;
  timestamp?: string;
}

export function createAdapterEvent(options: AdapterEventOptions): RunEvent {
  return {
    runId: options.runId,
    sequence: options.sequence,
    timestamp: options.timestamp ?? new Date().toISOString(),
    type: options.type,
    payload: { ...options.payload },
  };
}

export function createStatusEvent(
  runId: string,
  sequence: number,
  status: string,
  payload: Record<string, unknown> = {},
): RunEvent {
  return createAdapterEvent({ runId, sequence, type: "status", payload: { ...payload, status } });
}

export function createMessageEvent(
  runId: string,
  sequence: number,
  text: string,
  payload: Record<string, unknown> = {},
): RunEvent {
  return createAdapterEvent({ runId, sequence, type: "message", payload: { ...payload, text } });
}

export function createErrorEvent(
  runId: string,
  sequence: number,
  error: unknown,
  payload: Record<string, unknown> = {},
): RunEvent {
  const normalized = normalizeAdapterError(error);
  return createAdapterEvent({
    runId,
    sequence,
    type: "error",
    payload: {
      ...payload,
      status: statusForError(normalized.code),
      errorCode: normalized.code,
      message: normalized.message,
    },
  });
}

function statusForError(code: AdapterErrorCode): "failed" | "cancelled" | "timed_out" {
  if (code === "CANCELLED") return "cancelled";
  if (code === "TIMED_OUT") return "timed_out";
  return "failed";
}
