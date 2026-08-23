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
  mode: "explicit_profile" | "project_default" | "unique_candidate";
  profileId: Id;
  runtimeId: Id;
  candidates: Array<{
    profileId: Id;
    runtimeId: Id;
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

export interface SecretReference {
  provider: "env" | "keychain" | "custom";
  key: string;
}

export interface Policy {
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

export interface Profile {
  id: Id;
  runtimeId: Id;
  policyId: Id;
  extends?: Id;
  settings: Record<string, unknown>;
}

export interface Project {
  id: Id;
  rootDir: string;
  profileIds: Id[];
  defaultProfileId?: Id;
}

export interface Session {
  id: Id;
  projectId?: Id;
  runtimeId: Id;
  runtimeSessionId?: string;
  resumable: boolean;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface RunSnapshot {
  runtime: RuntimeDescriptor;
  profile: Profile;
  policy: Policy;
  project?: Project;
  routing?: RunRouteSnapshot;
  execution?: {
    workingDirectory: string;
    allowedEnvironmentKeys: string[];
    secretReferenceKeys: string[];
  };
}

export interface ExecutionContext {
  runtime: RuntimeDescriptor;
  profile: Profile;
  policy: Policy;
  project?: Project;
  workingDirectory: string;
  allowedEnvironmentKeys: string[];
  environment: Record<string, string>;
  secretReferences: Record<string, SecretReference>;
}

export interface Run {
  id: Id;
  runtimeId: Id;
  profileId: Id;
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
