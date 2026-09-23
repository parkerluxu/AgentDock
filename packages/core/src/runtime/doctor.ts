import { constants, existsSync, lstatSync } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { AdapterNativeHomeContract } from "../adapter-contract/index.js";
import type { AgentDockConfig } from "../config/schema.js";
import { configuredAgents, environmentCatalog } from "../config/model.js";
import { EnvironmentDirectoryManager } from "../environment/manager.js";
import { EnvironmentSecretResolver, type SecretResolver } from "../secrets/resolver.js";
import { SqliteRunStore } from "../storage/sqlite-run-store.js";
import { configBaseDirectory, configDataPath, runtimeDescriptors } from "./configuration.js";
import { createConfiguredRuntimeRegistry, type RuntimeRegistry } from "./registry.js";

export interface DoctorDiagnostic {
  scope: "runtime" | "project" | "storage" | "secret" | "environment" | "adapter" | "permission";
  id: string;
  healthy: boolean;
  severity?: "warning";
  message?: string;
  recommendedAction?: string;
  /** Structured diagnostics never contain a resolved secret value. */
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  healthy: boolean;
  /** Environment Permission is a launch constraint and audit policy, not a sandbox. */
  isSecuritySandbox: false;
  diagnostics: DoctorDiagnostic[];
}

export interface DoctorOptions {
  config: AgentDockConfig;
  configPath: string;
  registry?: RuntimeRegistry;
  secretResolver?: SecretResolver;
  checkStorage?: boolean;
  /** Restrict Environment-specific diagnostics to one configured Environment. */
  environmentId?: string;
}

export async function doctor(options: DoctorOptions): Promise<DoctorReport> {
  const diagnostics: DoctorDiagnostic[] = [];
  const registry = options.registry ?? await createConfiguredRuntimeRegistry(options.config, options.configPath);
  const secretResolver = options.secretResolver ?? new EnvironmentSecretResolver();
  const runtimeHealth = new Map<string, { healthy: boolean; version?: string }>();

  for (const runtime of runtimeDescriptors(options.config)) {
    if (!registry.list().includes(runtime.adapter)) {
      diagnostics.push({ scope: "runtime", id: runtime.id, healthy: false, message: `Adapter "${runtime.adapter}" is not registered.` });
      continue;
    }
    const health = await registry.create(runtime).healthCheck();
    runtimeHealth.set(runtime.id, { healthy: health.healthy, ...(health.runtime?.version ? { version: health.runtime.version } : {}) });
    diagnostics.push({
      scope: "runtime",
      id: runtime.id,
      healthy: health.healthy,
      ...(health.message ? { message: health.message } : {}),
    });
  }

  const baseDirectory = configBaseDirectory(options.configPath);
  const selectedEnvironmentIds = options.environmentId ? [options.environmentId] : options.config.environments.map((environment) => environment.id);
  if (options.environmentId && !options.config.environments.some((environment) => environment.id === options.environmentId)) {
    throw new Error(`Environment "${options.environmentId}" was not found.`);
  }
  const directoryManager = new EnvironmentDirectoryManager(options.config, baseDirectory);
  for (const environmentId of selectedEnvironmentIds) {
    await addEnvironmentDiagnostics({
      config: options.config,
      environmentId,
      directoryManager,
      registry,
      secretResolver,
      runtimeHealth,
      diagnostics,
    });
  }

  for (const project of options.config.projects) {
    const rootDir = resolve(baseDirectory, project.rootDir);
    diagnostics.push({
      scope: "project",
      id: project.id,
      healthy: existsSync(rootDir),
      ...(existsSync(rootDir) ? {} : { message: `Project root does not exist: ${rootDir}` }),
    });
  }

  if (options.checkStorage !== false) {
    try {
      const store = new SqliteRunStore(configDataPath(options.config, options.configPath), options.config.storage);
      store.close();
      diagnostics.push({ scope: "storage", id: "sqlite", healthy: true });
    } catch (error) {
      diagnostics.push({ scope: "storage", id: "sqlite", healthy: false, message: String(error) });
    }
  }

  const relevantPermissionIds = new Set(
    selectedEnvironmentIds.flatMap((environmentId) => environmentBindings(options.config, environmentId).map((binding) => binding.permissionId)),
  );
  for (const policy of environmentCatalog(options.config).permissions) {
    if (options.environmentId && !relevantPermissionIds.has(policy.id)) continue;
    for (const diagnostic of secretResolver.diagnose(policy.environment.secretRefs ?? {})) {
      diagnostics.push({
        scope: "secret",
        id: `${policy.id}/${diagnostic.name}`,
        healthy: diagnostic.healthy,
        ...(diagnostic.message ? { message: diagnostic.message } : {}),
      });
    }
  }

  return { healthy: diagnostics.every((diagnostic) => diagnostic.healthy), isSecuritySandbox: false, diagnostics };
}

interface EnvironmentDoctorContext {
  config: AgentDockConfig;
  environmentId: string;
  directoryManager: EnvironmentDirectoryManager;
  registry: RuntimeRegistry;
  secretResolver: SecretResolver;
  runtimeHealth: ReadonlyMap<string, { healthy: boolean; version?: string }>;
  diagnostics: DoctorDiagnostic[];
}

async function addEnvironmentDiagnostics(context: EnvironmentDoctorContext): Promise<void> {
  const environment = context.config.environments.find((item) => item.id === context.environmentId);
  if (!environment) return;
  let status: Awaited<ReturnType<EnvironmentDirectoryManager["inspect"]>>;
  try {
    status = await context.directoryManager.inspect(environment.id);
  } catch (error) {
    context.diagnostics.push({
      scope: "environment",
      id: environment.id,
      healthy: false,
      message: error instanceof Error ? error.message : String(error),
      recommendedAction: "Correct the Environment directory configuration, then run environment rescan.",
    });
    return;
  }
  const directoryCheck = await inspectEnvironmentDirectories(status.environment.configDir, status.environment.stateDir, status.environment.cacheDir);
  context.diagnostics.push({
    scope: "environment",
    id: `${environment.id}/directories`,
    healthy: status.healthy && directoryCheck.healthy,
    ...(status.healthy && directoryCheck.healthy ? {} : { message: directoryCheck.message ?? status.issues.join("; ") }),
    ...(status.healthy && directoryCheck.healthy ? {} : { recommendedAction: "Ensure the managed or external directories exist, are writable, and contain no symbolic links." }),
    details: {
      directoryMode: status.environment.directoryMode,
      configDir: status.environment.configDir,
      stateDir: status.environment.stateDir,
      cacheDir: status.environment.cacheDir,
      writable: directoryCheck.writable,
      symbolicLinkEntries: directoryCheck.symbolicLinkEntries,
    },
  });
  context.diagnostics.push({
    scope: "environment",
    id: `${environment.id}/manifest`,
    healthy: status.readiness === "ready",
    ...(status.readiness === "ready" ? {} : { message: status.readiness === "drifted" ? "Configuration hash differs from the confirmed manifest." : status.issues.join("; ") || "Environment has no confirmed manifest." }),
    ...(status.readiness === "ready" ? {} : { recommendedAction: "Review the native configuration and run environment rescan before executing." }),
    details: {
      readiness: status.readiness,
      drifted: status.drifted,
      ...(status.manifest ? { manifestConfigHash: status.manifest.configHash, lastScannedAt: status.manifest.scannedAt } : {}),
      ...(status.currentHash ? { currentConfigHash: status.currentHash } : {}),
    },
  });

  for (const binding of environmentBindings(context.config, environment.id)) {
    const engine = context.config.engines.find((item) => item.id === binding.engineId);
    const permission = context.config.environmentPermissions.find((item) => item.id === binding.permissionId);
    if (!engine || !permission) continue;
    if (!context.registry.list().includes(engine.adapter)) {
      context.diagnostics.push({ scope: "adapter", id: `${environment.id}/${binding.id}`, healthy: false, message: `Adapter "${engine.adapter}" is not registered.`, recommendedAction: "Install or enable the Adapter before using this Environment." });
    } else {
      const adapter = context.registry.create({ id: engine.id, adapter: engine.adapter, ...(engine.binary ? { binary: engine.binary } : {}), args: engine.args, ...(engine.version ? { version: engine.version } : {}), enabled: engine.enabled, capabilities: engine.capabilities });
      const contract = adapter.manifest.nativeHome;
      const observedVersion = context.runtimeHealth.get(engine.id)?.version ?? engine.version;
      const compatibility = evaluateRuntimeCompatibility(observedVersion, adapter.manifest.runtime.versionRange);
      context.diagnostics.push({
        scope: "adapter",
        id: `${environment.id}/${binding.id}`,
        healthy: compatibility.compatible,
        ...(contract ? {} : { severity: "warning" as const, message: "Adapter does not declare a native-home contract." }),
        ...(contract?.verification === "declared" ? { severity: "warning" as const, message: "Native-home contract is declared but has not been marked verified by a recorded Runtime smoke test." } : {}),
        ...(!compatibility.compatible ? { message: compatibility.message, recommendedAction: "Use a supported Runtime version or update the Adapter native-home contract." } : {}),
        ...(contract?.verification === "declared" && compatibility.compatible ? { recommendedAction: "Run the documented low-cost Runtime smoke test before promoting this compatibility claim." } : {}),
        details: {
          agentId: binding.id,
          engineId: engine.id,
          adapter: adapter.manifest.name,
          runtimeBinary: engine.binary ?? engine.adapter,
          configuredVersion: engine.version ?? null,
          observedVersion: observedVersion ?? null,
          supportedVersionRange: adapter.manifest.runtime.versionRange ?? "*",
          capabilities: adapter.manifest.capabilities,
          ...(contract ? { nativeHome: summarizeNativeHomeContract(contract) } : {}),
        },
      });
    }
    const secretDiagnostics = context.secretResolver.diagnose(permission.environment.secretRefs ?? {});
    context.diagnostics.push({
      scope: "permission",
      id: `${environment.id}/${binding.id}`,
      healthy: secretDiagnostics.every((diagnostic) => diagnostic.healthy),
      ...(secretDiagnostics.every((diagnostic) => diagnostic.healthy) ? {} : { message: "One or more Secret References cannot be resolved." }),
      ...(secretDiagnostics.every((diagnostic) => diagnostic.healthy) ? {} : { recommendedAction: "Configure the referenced secret provider; values are intentionally not shown." }),
      details: {
        permissionId: permission.id,
        isSecuritySandbox: false,
        filesystem: permission.filesystem,
        network: permission.network,
        allowedEnvironmentKeys: [...permission.environment.allow].sort(),
        secretReferenceNames: Object.keys(permission.environment.secretRefs ?? {}).sort(),
      },
    });
  }
}

function environmentBindings(config: AgentDockConfig, environmentId: string): Array<{ id: string; engineId: string; permissionId: string }> {
  const agents = configuredAgents(config).filter((agent) => agent.environmentId === environmentId);
  if (agents.length > 0) return agents.map((agent) => ({ id: agent.id, engineId: agent.engineId, permissionId: agent.permissionId }));
  const environment = config.environments.find((item) => item.id === environmentId);
  return environment?.engineId && environment.permissionId
    ? [{ id: `legacy:${environment.id}`, engineId: environment.engineId, permissionId: environment.permissionId }]
    : [];
}

async function inspectEnvironmentDirectories(configDir: string | undefined, stateDir: string | undefined, cacheDir: string | undefined): Promise<{ healthy: boolean; message?: string; writable: Record<string, boolean>; symbolicLinkEntries: number }> {
  const paths = { configDir, stateDir, cacheDir };
  const writable: Record<string, boolean> = {};
  let symbolicLinkEntries = 0;
  for (const [kind, path] of Object.entries(paths)) {
    if (!path || !existsSync(path)) {
      writable[kind] = false;
      continue;
    }
    try {
      await access(path, constants.W_OK);
      writable[kind] = true;
    } catch {
      writable[kind] = false;
    }
    if (kind === "configDir") symbolicLinkEntries = await countSymbolicLinks(path);
  }
  const missingOrReadonly = Object.entries(writable).filter(([, value]) => !value).map(([kind]) => kind);
  if (missingOrReadonly.length > 0) return { healthy: false, message: `Missing or non-writable Environment directories: ${missingOrReadonly.join(", ")}.`, writable, symbolicLinkEntries };
  if (symbolicLinkEntries > 0) return { healthy: false, message: "Environment configDir contains symbolic links.", writable, symbolicLinkEntries };
  return { healthy: true, writable, symbolicLinkEntries };
}

async function countSymbolicLinks(root: string): Promise<number> {
  try {
    if (lstatSync(root).isSymbolicLink()) return 1;
    let count = 0;
    const visit = async (current: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) count += 1;
        else if (entry.isDirectory() && count <= 10_000) await visit(resolve(current, entry.name));
      }
    };
    await visit(root);
    return count;
  } catch {
    return 0;
  }
}

function summarizeNativeHomeContract(contract: AdapterNativeHomeContract): Record<string, unknown> {
  return {
    contractVersion: contract.contractVersion,
    homeEnvironmentVariables: contract.homeEnvironmentVariables,
    configEnvironmentVariables: contract.configEnvironmentVariables,
    stateEnvironmentVariables: contract.stateEnvironmentVariables,
    cacheEnvironmentVariables: contract.cacheEnvironmentVariables,
    mutableDirectories: contract.mutableDirectories,
    ...(contract.session ? { session: contract.session } : {}),
    verification: contract.verification,
  };
}

function evaluateRuntimeCompatibility(version: string | undefined, range: string | undefined): { compatible: boolean; message?: string } {
  if (!version || !range || range === "*") return { compatible: true };
  const parsed = parseVersion(version);
  if (!parsed) return { compatible: true };
  const terms = range.trim().split(/\s+/u);
  for (const term of terms) {
    const match = /^(>=|<=|>|<|=|~|\^)?(\d+\.\d+(?:\.\d+)?)/u.exec(term);
    if (!match || !match[2]) continue;
    const target = parseVersion(match[2]);
    if (!target) continue;
    const comparison = compareVersions(parsed, target);
    const operator = match[1] ?? "=";
    const allowed = operator === ">=" ? comparison >= 0
      : operator === "<=" ? comparison <= 0
        : operator === ">" ? comparison > 0
          : operator === "<" ? comparison < 0
            : operator === "^" ? parsed[0] === target[0] && comparison >= 0
              : operator === "~" ? parsed[0] === target[0] && parsed[1] === target[1] && comparison >= 0
                : comparison === 0;
    if (!allowed) return { compatible: false, message: `Runtime version ${version} is outside Adapter support range ${range}.` };
  }
  return { compatible: true };
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/u.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")] : undefined;
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (const index of [0, 1, 2] as const) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}
