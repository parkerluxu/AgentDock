export type Id = string;

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export type RuntimeCapability =
  | "execute"
  | "stream_events"
  | "cancel"
  | "create_session"
  | "resume_session"
  | "healthcheck";

export interface RunRouteSnapshot {
  mode: "explicit_agent" | "explicit_environment" | "project_default" | "unique_candidate";
  agentId?: Id;
  environmentId: Id;
  engineId?: Id;
  candidates: Array<{
    agentId?: Id;
    environmentId: Id;
    engineId: Id;
    health: "healthy" | "unknown" | "unhealthy";
    accepted: boolean;
    reasons: string[];
  }>;
  explanation: string;
}

export type NetworkPolicy = "deny" | "allow";

export interface RuntimeDescriptor {
  id: Id;
  adapter: string;
  binary?: string;
  args: string[];
  version?: string;
  enabled: boolean;
  capabilities: RuntimeCapability[];
}

/** Primary product model. RuntimeDescriptor remains as its v1 wire-compatible shape. */
export interface AgentEngine extends RuntimeDescriptor {}

export interface Agent {
  id: Id;
  engineId: Id;
  environmentId: Id;
  permissionId: Id;
  enabled: boolean;
  processEnv: Record<string, string>;
  settings: Record<string, unknown>;
}

export interface SecretReference {
  provider: "env" | "keychain" | "custom";
  key: string;
}

export interface EnvironmentPermission {
  id: Id;
  filesystem: {
    roots: string[];
    write: boolean;
  };
  environment: {
    allow: string[];
    secretRefs?: Record<string, SecretReference>;
  };
  network: NetworkPolicy;
}

export type EnvironmentDirectoryMode = "managed" | "external";

export interface AgentEnvironment {
  id: Id;
  engineId?: Id;
  permissionId?: Id;
  extends?: Id;
  directoryMode: EnvironmentDirectoryMode;
  homeDir?: string;
  configDir?: string;
  stateDir?: string;
  cacheDir?: string;
  launchArgs: string[];
  settings: Record<string, unknown>;
}

export interface EnvironmentManifest {
  manifestVersion: 1;
  environmentId: Id;
  engineId?: Id;
  directoryMode: EnvironmentDirectoryMode;
  homeDir?: string;
  configDir: string;
  stateDir: string;
  cacheDir: string;
  configHash: string;
  scannedAt: string;
}

export interface Project {
  id: Id;
  rootDir: string;
  agentIds?: Id[];
  defaultAgentId?: Id;
  environmentIds: Id[];
  defaultEnvironmentId?: Id;
}

export interface Session {
  id: Id;
  projectId?: Id;
  agentId?: Id;
  engineId: Id;
  environmentId?: Id;
  runtimeSessionId?: string;
  resumable: boolean;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface RunSnapshot {
  agent?: Agent;
  engine: AgentEngine;
  environment: AgentEnvironment;
  environmentPermission: EnvironmentPermission;
  project?: Project;
  routing?: RunRouteSnapshot;
  execution?: {
    workingDirectory: string;
    allowedEnvironmentKeys: string[];
    secretReferenceKeys: string[];
  };
  environmentManifest?: EnvironmentManifest;
  environmentConfigHash?: string;
}

export interface ExecutionContext {
  agent?: Agent;
  engine: AgentEngine;
  agentEnvironment: AgentEnvironment;
  environmentPermission: EnvironmentPermission;
  project?: Project;
  workingDirectory: string;
  allowedEnvironmentKeys: string[];
  environment: Record<string, string>;
  secretReferences: Record<string, SecretReference>;
  environmentManifest?: EnvironmentManifest;
}

export interface Run {
  id: Id;
  agentId?: Id;
  engineId: Id;
  environmentId: Id;
  projectId?: Id;
  sessionId?: Id;
  task: string;
  status: RunStatus;
  snapshot: RunSnapshot;
  createdAt: string;
  ownerPid?: number;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  errorCode?: string;
}

export interface RunEvent {
  runId: Id;
  sequence: number;
  timestamp: string;
  type: "status" | "message" | "tool_call" | "tool_result" | "error";
  payload: Record<string, unknown>;
}
