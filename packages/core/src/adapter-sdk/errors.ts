export type AdapterErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "UNSUPPORTED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "EXECUTION_FAILED"
  | "UNKNOWN";

export interface AdapterErrorInfo {
  code: AdapterErrorCode;
  message: string;
  retryable: boolean;
}

export class AdapterExecutionError extends Error {
  public readonly code: AdapterErrorCode;
  public readonly retryable: boolean;

  public constructor(message: string, code: AdapterErrorCode = "EXECUTION_FAILED", retryable = false) {
    super(message);
    this.name = "AdapterExecutionError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function normalizeAdapterError(error: unknown): AdapterErrorInfo {
  if (error instanceof AdapterExecutionError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }

  const object = isRecord(error) ? error : undefined;
  const rawCode = typeof object?.code === "string" ? object.code.toUpperCase() : "";
  const message = error instanceof Error ? error.message : String(error);
  if (rawCode === "ENOENT" || /not found|cannot find/i.test(message)) return { code: "NOT_FOUND", message, retryable: false };
  if (rawCode === "ABORT_ERR" || /aborted|cancelled|canceled/i.test(message)) return { code: "CANCELLED", message, retryable: false };
  if (rawCode === "ETIMEDOUT" || /timed out|timeout/i.test(message)) return { code: "TIMED_OUT", message, retryable: true };
  if (/unsupported/i.test(message)) return { code: "UNSUPPORTED", message, retryable: false };
  if (/invalid|malformed/i.test(message)) return { code: "INVALID_REQUEST", message, retryable: false };
  if (error instanceof Error) return { code: "EXECUTION_FAILED", message, retryable: false };
  return { code: "UNKNOWN", message, retryable: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
