import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { configuredAgents } from "../config/model.js";
import type { AgentDockConfig } from "../config/schema.js";
import type { Agent, Run, Session } from "../core/types.js";
import { EnvironmentDirectoryManager, type EnvironmentStatus } from "../environment/manager.js";
import { SqliteRunStore } from "../storage/sqlite-run-store.js";
import { configBaseDirectory } from "./configuration.js";
import type { RuntimeRegistry } from "./registry.js";
import type { RuntimeHealthStatus } from "./router.js";

/** A conservative health status: unknown is deliberately distinct from healthy. */
export type AgentHealthStatus = "healthy" | "unknown" | "unhealthy";

export interface AgentHealthEngine {
  id: string;
  adapter: string;
  binary?: string;
  configuredVersion?: string;
  enabled: boolean;
  adapterRegistered: boolean;
  /** Supplied probe state, if one exists; this read model never launches a Runtime. */
  runtimeHealth: RuntimeHealthStatus;
  status: AgentHealthStatus;
  reasons: string[];
}

export interface AgentHealthEnvironment {
  id: string;
  readiness: "ready" | "drifted" | "invalid";
  drifted: boolean;
  status: AgentHealthStatus;
  manifestConfigHash?: string;
  lastScannedAt?: string;
  reasons: string[];
}

export interface AgentHealthPermission {
  id: string;
  status: AgentHealthStatus;
  network?: "allow" | "deny";
  filesystem?: { rootCount: number; write: boolean };
  allowedEnvironmentKeys: string[];
  secretReferenceNames: string[];
  /** Environment Permission is a launch constraint and audit policy, never a sandbox. */
  isSecuritySandbox: false;
  reasons: string[];
}

export interface AgentHealthProjectBinding {
  id: string;
  isDefault: boolean;
  rootExists: boolean;
  status: AgentHealthStatus;
  reasons: string[];
}

export interface AgentHealthSessionSummary {
  total: number;
  active: number;
  resumable: number;
  status: AgentHealthStatus;
  reasons: string[];
  recent: Array<Pick<Session, "id" | "projectId" | "status" | "resumable" | "updatedAt">>;
}

export interface AgentHealthRunSummary {
  total: number;
  recent: Array<Pick<Run, "id" | "projectId" | "sessionId" | "status" | "createdAt" | "finishedAt" | "errorCode">>;
}

export interface AgentHealth {
  agentId: string;
  enabled: boolean;
  status: AgentHealthStatus;
  lastCheckedAt: string;
  engine: AgentHealthEngine;
  environment: AgentHealthEnvironment;
  permission: AgentHealthPermission;
  projects: { status: AgentHealthStatus; bindings: AgentHealthProjectBinding[]; reasons: string[] };
  sessions: AgentHealthSessionSummary;
  runs: AgentHealthRunSummary;
  reasons: string[];
  recommendedActions: string[];
}

export interface AgentHealthReport {
  checkedAt: string;
  /** The report only inspects local config, manifests, directories, and SQLite metadata. */
  readOnly: true;
  isSecuritySandbox: false;
  agents: AgentHealth[];
}

export interface AgentHealthReadOptions {
  config: AgentDockConfig;
  configPath: string;
  registry: RuntimeRegistry;
  store: SqliteRunStore;
  engineHealth?: Readonly<Record<string, RuntimeHealthStatus>>;
}

export interface AgentHealthReadModelOptions {
  /** Health reports are cached to keep dashboard refreshes inexpensive. */
  cacheTtlMs?: number;
  /** Directory inspection is bounded; timeouts are reported as unknown rather than blocking the dashboard. */
  directoryInspectionTimeoutMs?: number;
}

/**
 * Builds a cached, non-invasive dashboard read model. In particular, it never
 * invokes Adapter.healthCheck() because that can spawn a native Runtime.
 */
export class AgentHealthReadModel {
  private readonly cacheTtlMs: number;
  private readonly directoryInspectionTimeoutMs: number;
  private cached: { expiresAt: number; report: AgentHealthReport } | undefined;
  private pending: Promise<AgentHealthReport> | undefined;

  public constructor(options: AgentHealthReadModelOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 5_000;
    this.directoryInspectionTimeoutMs = options.directoryInspectionTimeoutMs ?? 1_000;
  }

  public invalidate(): void {
    this.cached = undefined;
    // A configuration reload must not let an older in-flight inspection fill
    // the cache after it completes. The old caller can still receive its own
    // result; all later callers build from the new configuration.
    this.pending = undefined;
  }

  public async read(options: AgentHealthReadOptions): Promise<AgentHealthReport> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.report;
    if (this.pending) return this.pending;
    const operation = buildAgentHealthReport(options, this.directoryInspectionTimeoutMs);
    this.pending = operation;
    try {
      const report = await operation;
      if (this.pending === operation) this.cached = { report, expiresAt: Date.now() + this.cacheTtlMs };
      return report;
    } finally {
      if (this.pending === operation) this.pending = undefined;
    }
  }
}

export async function buildAgentHealthReport(
  options: AgentHealthReadOptions,
  directoryInspectionTimeoutMs = 1_000,
): Promise<AgentHealthReport> {
  const checkedAt = new Date().toISOString();
  const baseDirectory = configBaseDirectory(options.configPath);
  const directoryManager = new EnvironmentDirectoryManager(options.config, baseDirectory);
  const environmentStatuses = new Map<string, EnvironmentStatus | { message: string }>();
  await Promise.all(options.config.environments.map(async (environment) => {
    environmentStatuses.set(environment.id, await readEnvironmentStatus(directoryManager, environment.id, directoryInspectionTimeoutMs));
  }));

  const sessions = options.store.listSessions();
  const runs = options.store.listRuns({ limit: 1_000 });
  const registeredAdapters = new Set(options.registry.list());
  const agents = configuredAgents(options.config).map((agent) => buildAgentHealth({
    agent,
    config: options.config,
    baseDirectory,
    checkedAt,
    environment: environmentStatuses.get(agent.environmentId),
    sessions,
    runs,
    registeredAdapters,
    ...(options.engineHealth ? { engineHealth: options.engineHealth } : {}),
  }));
  return { checkedAt, readOnly: true, isSecuritySandbox: false, agents };
}

interface BuildAgentHealthContext {
  agent: Agent;
  config: AgentDockConfig;
  baseDirectory: string;
  checkedAt: string;
  environment: EnvironmentStatus | { message: string } | undefined;
  sessions: Session[];
  runs: Run[];
  registeredAdapters: ReadonlySet<string>;
  engineHealth?: Readonly<Record<string, RuntimeHealthStatus>>;
}

function buildAgentHealth(context: BuildAgentHealthContext): AgentHealth {
  const { agent, config } = context;
  const engine = config.engines.find((item) => item.id === agent.engineId);
  const permission = config.environmentPermissions.find((item) => item.id === agent.permissionId);
  const engineSummary = summarizeEngine(agent, engine, context.registeredAdapters, context.engineHealth);
  const environmentSummary = summarizeEnvironment(agent.environmentId, context.environment);
  const permissionSummary = summarizePermission(agent.permissionId, permission);
  const projectSummary = summarizeProjects(agent, config, context.baseDirectory);
  const sessionSummary = summarizeSessions(agent, context.sessions);
  const runSummary = summarizeRuns(agent, context.runs);
  const reasons = [
    ...(!agent.enabled ? [`Agent "${agent.id}" is disabled.`] : []),
    ...engineSummary.reasons,
    ...environmentSummary.reasons,
    ...permissionSummary.reasons,
    ...projectSummary.reasons,
  ];
  const componentStatuses: AgentHealthStatus[] = [
    agent.enabled ? "healthy" : "unhealthy",
    engineSummary.status,
    environmentSummary.status,
    permissionSummary.status,
    projectSummary.status,
  ];
  const status = aggregateStatus(componentStatuses);
  const recommendedActions = unique([
    ...(!agent.enabled ? ["Enable the Agent before invoking it."] : []),
    ...engineSummary.status === "unhealthy" ? ["Correct the Engine configuration or install its Adapter."] : [],
    ...engineSummary.runtimeHealth === "unknown" ? [`Run engine health ${engineSummary.id} to probe the native Runtime.`] : [],
    ...environmentSummary.status === "unhealthy" ? [`Repair Environment "${environmentSummary.id}" and run environment rescan.`] : [],
    ...permissionSummary.status === "unhealthy" ? ["Correct the Environment Permission binding."] : [],
    ...projectSummary.status === "unhealthy" ? ["Create the missing Project directory or update its rootDir."] : [],
    ...projectSummary.status === "unknown" ? ["Bind this Agent to a Project when it should be selected by Project routing."] : [],
  ]);
  return {
    agentId: agent.id,
    enabled: agent.enabled,
    status,
    lastCheckedAt: context.checkedAt,
    engine: engineSummary,
    environment: environmentSummary,
    permission: permissionSummary,
    projects: projectSummary,
    sessions: sessionSummary,
    runs: runSummary,
    reasons: unique(reasons),
    recommendedActions,
  };
}

function summarizeEngine(
  agent: Agent,
  engine: AgentDockConfig["engines"][number] | undefined,
  registeredAdapters: ReadonlySet<string>,
  engineHealth: Readonly<Record<string, RuntimeHealthStatus>> | undefined,
): AgentHealthEngine {
  if (!engine) {
    return {
      id: agent.engineId,
      adapter: "",
      enabled: false,
      adapterRegistered: false,
      runtimeHealth: "unhealthy",
      status: "unhealthy",
      reasons: [`Engine "${agent.engineId}" is not configured.`],
    };
  }
  const adapterRegistered = registeredAdapters.has(engine.adapter);
  const runtimeHealth = engineHealth?.[engine.id] ?? "unknown";
  const reasons = [
    ...(!engine.enabled ? [`Engine "${engine.id}" is disabled.`] : []),
    ...(!adapterRegistered ? [`Adapter "${engine.adapter}" is not registered.`] : []),
    ...(runtimeHealth === "unhealthy" ? [`Engine "${engine.id}" was reported unhealthy.`] : []),
    ...(runtimeHealth === "unknown" ? ["Native Runtime has not been probed by this dashboard refresh."] : []),
  ];
  const status = !engine.enabled || !adapterRegistered || runtimeHealth === "unhealthy"
    ? "unhealthy"
    : runtimeHealth === "healthy" ? "healthy" : "unknown";
  return {
    id: engine.id,
    adapter: engine.adapter,
    ...(engine.binary ? { binary: engine.binary } : {}),
    ...(engine.version ? { configuredVersion: engine.version } : {}),
    enabled: engine.enabled,
    adapterRegistered,
    runtimeHealth,
    status,
    reasons,
  };
}

function summarizeEnvironment(
  environmentId: string,
  status: EnvironmentStatus | { message: string } | undefined,
): AgentHealthEnvironment {
  if (!status) return { id: environmentId, readiness: "invalid", drifted: false, status: "unhealthy", reasons: [`Environment "${environmentId}" is not configured.`] };
  if ("message" in status) return { id: environmentId, readiness: "invalid", drifted: false, status: "unknown", reasons: [status.message] };
  const reasons = [
    ...(status.readiness === "ready" ? [] : status.issues.length > 0 ? status.issues : [status.readiness === "drifted" ? "Environment configuration differs from its confirmed manifest." : "Environment has no confirmed manifest."]),
  ];
  return {
    id: environmentId,
    readiness: status.readiness,
    drifted: status.drifted,
    status: status.readiness === "ready" ? "healthy" : "unhealthy",
    ...(status.manifest ? { manifestConfigHash: status.manifest.configHash, lastScannedAt: status.manifest.scannedAt } : {}),
    reasons,
  };
}

function summarizePermission(
  permissionId: string,
  permission: AgentDockConfig["environmentPermissions"][number] | undefined,
): AgentHealthPermission {
  if (!permission) {
    return { id: permissionId, status: "unhealthy", allowedEnvironmentKeys: [], secretReferenceNames: [], isSecuritySandbox: false, reasons: [`Environment Permission "${permissionId}" is not configured.`] };
  }
  return {
    id: permission.id,
    status: "healthy",
    network: permission.network,
    filesystem: { rootCount: permission.filesystem.roots.length, write: permission.filesystem.write },
    allowedEnvironmentKeys: [...permission.environment.allow].sort(),
    secretReferenceNames: Object.keys(permission.environment.secretRefs ?? {}).sort(),
    isSecuritySandbox: false,
    reasons: [],
  };
}

function summarizeProjects(agent: Agent, config: AgentDockConfig, baseDirectory: string): AgentHealth["projects"] {
  const bindings = config.projects.filter((project) => isAgentAllowed(project, agent)).map((project) => {
    const rootExists = existsSync(resolve(baseDirectory, project.rootDir));
    return {
      id: project.id,
      isDefault: project.defaultAgentId === agent.id || (!project.defaultAgentId && project.defaultEnvironmentId === agent.environmentId),
      rootExists,
      status: rootExists ? "healthy" : "unhealthy",
      reasons: rootExists ? [] : [`Project root does not exist: ${project.rootDir}`],
    } satisfies AgentHealthProjectBinding;
  });
  if (bindings.length === 0) {
    return { status: "unknown", bindings, reasons: [`Agent "${agent.id}" is not enabled for any Project.`] };
  }
  return {
    status: bindings.some((binding) => binding.status === "unhealthy") ? "unhealthy" : "healthy",
    bindings,
    reasons: bindings.flatMap((binding) => binding.reasons),
  };
}

function summarizeSessions(agent: Agent, sessions: Session[]): AgentHealthSessionSummary {
  const related = sessions.filter((session) => session.agentId === agent.id);
  const active = related.filter((session) => session.status === "active");
  const nonResumable = active.filter((session) => !session.resumable);
  return {
    total: related.length,
    active: active.length,
    resumable: related.filter((session) => session.resumable).length,
    status: nonResumable.length > 0 ? "unknown" : "healthy",
    reasons: nonResumable.map((session) => `Active Session "${session.id}" cannot be resumed by its Adapter.`),
    recent: related.slice(0, 5).map(({ id, projectId, status, resumable, updatedAt }) => ({ id, ...(projectId ? { projectId } : {}), status, resumable, updatedAt })),
  };
}

function summarizeRuns(agent: Agent, runs: Run[]): AgentHealthRunSummary {
  const related = runs.filter((run) => run.agentId === agent.id);
  return {
    total: related.length,
    recent: related.slice(0, 5).map(({ id, projectId, sessionId, status, createdAt, finishedAt, errorCode }) => ({
      id,
      ...(projectId ? { projectId } : {}),
      ...(sessionId ? { sessionId } : {}),
      status,
      createdAt,
      ...(finishedAt ? { finishedAt } : {}),
      ...(errorCode ? { errorCode } : {}),
    })),
  };
}

function isAgentAllowed(project: AgentDockConfig["projects"][number], agent: Agent): boolean {
  if (project.agentIds?.length) return project.agentIds.includes(agent.id);
  return project.environmentIds.includes(agent.environmentId);
}

async function readEnvironmentStatus(
  manager: EnvironmentDirectoryManager,
  environmentId: string,
  timeoutMs: number,
): Promise<EnvironmentStatus | { message: string }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      manager.inspect(environmentId),
      new Promise<{ message: string }>((resolve) => {
        timer = setTimeout(() => resolve({ message: `Environment inspection timed out after ${timeoutMs} ms.` }), timeoutMs);
      }),
    ]);
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function aggregateStatus(statuses: AgentHealthStatus[]): AgentHealthStatus {
  if (statuses.includes("unhealthy")) return "unhealthy";
  if (statuses.includes("unknown")) return "unknown";
  return "healthy";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
