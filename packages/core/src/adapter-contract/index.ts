import type {
  RuntimeCapability,
  RuntimeDescriptor,
  RunEvent,
  SecretReference,
} from "../core/types.js";

export const AGENTDOCK_ADAPTER_API_VERSION = "v1" as const;

export type AdapterPermission =
  | "filesystem.read"
  | "filesystem.write"
  | "network"
  | "shell"
  | "secret.read";

const runtimeCapabilities: RuntimeCapability[] = [
  "execute",
  "stream_events",
  "cancel",
  "create_session",
  "resume_session",
  "healthcheck",
];

const adapterPermissions: AdapterPermission[] = [
  "filesystem.read",
  "filesystem.write",
  "network",
  "shell",
  "secret.read",
];

export interface AdapterManifest {
  name: string;
  version: string;
  /** Package or module entry point used by a local Adapter loader. */
  entry: string;
  agentDockApi: typeof AGENTDOCK_ADAPTER_API_VERSION;
  runtime: {
    id: string;
    versionRange?: string;
  };
  capabilities: RuntimeCapability[];
  requiredPermissions: AdapterPermission[];
  /**
   * Declarative native-home behavior used by Environment doctor and release
   * compatibility records. Optional for third-party adapter compatibility,
   * but built-in native CLI adapters must publish it.
   */
  nativeHome?: AdapterNativeHomeContract;
}

export type NativeHomeMutableDirectory = "config" | "state" | "cache" | "session";

export interface AdapterNativeHomeContract {
  contractVersion: 1;
  /** Native Runtime variables that select the complete home or its partitions. */
  homeEnvironmentVariables: string[];
  configEnvironmentVariables: string[];
  stateEnvironmentVariables: string[];
  cacheEnvironmentVariables: string[];
  /** Directory categories the native Runtime may change during a Run. */
  mutableDirectories: NativeHomeMutableDirectory[];
  /** Native CLI syntax recorded without secrets or actual session IDs. */
  session?: { createArgument?: string; resumeArgument?: string };
  /** `verified` is reserved for a documented, low-cost real Runtime smoke test. */
  verification: "declared" | "verified";
}

export interface AdapterManifestIssue {
  path: string;
  message: string;
}

export class AdapterManifestValidationError extends Error {
  public readonly issues: AdapterManifestIssue[];

  public constructor(issues: AdapterManifestIssue[]) {
    super(`Adapter manifest is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}).`);
    this.name = "AdapterManifestValidationError";
    this.issues = issues;
  }
}

export interface AdapterHealth {
  healthy: boolean;
  runtime?: RuntimeDescriptor;
  message?: string;
}

export interface AdapterTaskRequest {
  runId: string;
  task: string;
  workingDirectory: string;
  environment: Record<string, string>;
  secretReferences: Record<string, SecretReference>;
  runtime: RuntimeDescriptor;
  settings: Record<string, unknown>;
  runtimeSessionId?: string;
  /** Whether the native Runtime session must be created or resumed for this Run. */
  sessionMode?: "create" | "resume";
  signal: AbortSignal;
}

export interface AdapterSessionReference {
  supported: boolean;
  runtimeSessionId?: string;
  /** `pending` IDs require the first Run to create the native session before they can be resumed. */
  state?: "pending" | "active";
}

export interface AgentAdapter {
  readonly manifest: AdapterManifest;
  healthCheck(signal?: AbortSignal): Promise<AdapterHealth>;
  execute(request: AdapterTaskRequest): AsyncIterable<RunEvent>;
  cancel(runId: string): Promise<void>;
  createSession?(signal?: AbortSignal): Promise<AdapterSessionReference>;
  resumeSession?(runtimeSessionId: string, signal?: AbortSignal): Promise<AdapterSessionReference>;
}

export function isCapabilitySupported(
  manifest: AdapterManifest,
  capability: RuntimeCapability,
): boolean {
  return manifest.capabilities.includes(capability);
}

/** Validate a manifest at the boundary where an Adapter enters AgentDock. */
export function validateAdapterManifest(input: unknown): AdapterManifest {
  const issues: AdapterManifestIssue[] = [];
  if (!isRecord(input)) {
    throw new AdapterManifestValidationError([{ path: "<root>", message: "must be an object." }]);
  }

  requireString(input, "name", issues);
  const version = requireString(input, "version", issues);
  requireString(input, "entry", issues);
  if (input.agentDockApi !== AGENTDOCK_ADAPTER_API_VERSION) {
    issues.push({ path: "agentDockApi", message: `must be "${AGENTDOCK_ADAPTER_API_VERSION}".` });
  }
  const runtime = input.runtime;
  if (!isRecord(runtime)) {
    issues.push({ path: "runtime", message: "must be an object." });
  } else {
    requireString(runtime, "id", issues, "runtime");
    if (runtime.versionRange !== undefined && (typeof runtime.versionRange !== "string" || !isVersionRange(runtime.versionRange))) {
      issues.push({ path: "runtime.versionRange", message: "must be a supported version range." });
    }
  }
  const capabilities = validateList(input.capabilities, runtimeCapabilities, "capabilities", issues);
  const permissions = validateList(input.requiredPermissions, adapterPermissions, "requiredPermissions", issues);
  if (input.nativeHome !== undefined) validateNativeHomeContract(input.nativeHome, issues);

  if (version !== undefined && !isSemver(version)) {
    issues.push({ path: "version", message: "must be a semantic version such as 0.1.0." });
  }
  if (issues.length > 0) throw new AdapterManifestValidationError(issues);

  return input as unknown as AdapterManifest;
}

function validateNativeHomeContract(value: unknown, issues: AdapterManifestIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path: "nativeHome", message: "must be an object." });
    return;
  }
  if (value.contractVersion !== 1) issues.push({ path: "nativeHome.contractVersion", message: "must be 1." });
  for (const key of ["homeEnvironmentVariables", "configEnvironmentVariables", "stateEnvironmentVariables", "cacheEnvironmentVariables"] as const) {
    if (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(item))) {
      issues.push({ path: `nativeHome.${key}`, message: "must be an array of uppercase environment variable names." });
    } else if (new Set(value[key]).size !== value[key].length) {
      issues.push({ path: `nativeHome.${key}`, message: "must not contain duplicates." });
    }
  }
  const mutableDirectories = ["config", "state", "cache", "session"] as const;
  if (!Array.isArray(value.mutableDirectories) || value.mutableDirectories.some((item) => typeof item !== "string" || !mutableDirectories.includes(item as NativeHomeMutableDirectory))) {
    issues.push({ path: "nativeHome.mutableDirectories", message: "contains an unsupported directory category." });
  } else if (new Set(value.mutableDirectories).size !== value.mutableDirectories.length) {
    issues.push({ path: "nativeHome.mutableDirectories", message: "must not contain duplicates." });
  }
  if (value.verification !== "declared" && value.verification !== "verified") {
    issues.push({ path: "nativeHome.verification", message: "must be \"declared\" or \"verified\"." });
  }
  if (value.session !== undefined) {
    if (!isRecord(value.session)) issues.push({ path: "nativeHome.session", message: "must be an object." });
    else {
      for (const key of ["createArgument", "resumeArgument"] as const) {
        if (value.session[key] !== undefined && (typeof value.session[key] !== "string" || value.session[key].trim().length === 0)) {
          issues.push({ path: `nativeHome.session.${key}`, message: "must be a non-empty string." });
        }
      }
    }
  }
}

export function isValidAdapterManifest(input: unknown): input is AdapterManifest {
  try {
    validateAdapterManifest(input);
    return true;
  } catch (error) {
    if (error instanceof AdapterManifestValidationError) return false;
    throw error;
  }
}

export function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

export function isVersionRange(value: string): boolean {
  if (value.trim() === "*") return true;
  const terms = value.trim().split(/\s+/);
  return terms.length > 0 && terms.every((term) => /^(?:[<>=~^]{0,2})?\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.test(term));
}

function requireString(record: Record<string, unknown>, key: string, issues: AdapterManifestIssue[], prefix = ""): string | undefined {
  const value = record[key];
  const path = prefix ? `${prefix}.${key}` : key;
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path, message: "must be a non-empty string." });
    return undefined;
  }
  return value;
}

function validateList<T extends string>(
  value: unknown,
  supported: readonly T[],
  path: string,
  issues: AdapterManifestIssue[],
): T[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array." });
    return [];
  }
  const result: T[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !supported.includes(item as T)) {
      issues.push({ path: `${path}.${index}`, message: `contains an unsupported value "${String(item)}".` });
      continue;
    }
    if (result.includes(item as T)) issues.push({ path: `${path}.${index}`, message: `contains duplicate value "${item}".` });
    result.push(item as T);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
