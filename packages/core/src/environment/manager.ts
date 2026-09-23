import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { appendFile, cp, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import type { AgentDockConfig, ConfigEnvironment } from "../config/schema.js";
import { environmentCatalog } from "../config/model.js";
import { AgentDockError } from "../core/errors.js";
import type { AgentEnvironment, EnvironmentManifest } from "../core/types.js";

const MANIFEST_NAME = "manifest.json";
const TEMPLATE_METADATA_NAME = "template.json";
const MAX_CONFIG_FILES = 10_000;
const MAX_CONFIG_BYTES = 64 * 1024 * 1024;
const IGNORED_CONFIG_ROOTS = new Set(["cache", "logs", "log", "browser", "tmp", ".tmp", "attachments", "backups", "state", "sessions", "archived_sessions", "history", "visualizations", "sqlite", "node_repl", ".sandbox", ".sandbox-bin", ".sandbox-secrets", "process_manager", "thread-writer-locks", "mcp-oauth-locks", "dictation-history", "computer-use", "pets", "memories", "ambient-suggestions"]);
const IGNORED_CONFIG_FILES = new Set(["models_cache.json", "auth.json", ".credentials.json", "credentials.json", "token.json", ".token", "oauth.json", ".env"]);
const IGNORED_PLUGIN_ROOTS = new Set(["cache", "node_modules", "data", "prebuilds", ".plugin-appserver", ".marketplace-plugin-source-staging"]);
const SENSITIVE_NAME_MARKERS = ["auth", "credential", "oauth", "token", "secret", "apikey", "api_key", "password"];

export type EnvironmentExcludedPathCategory = "cache" | "database" | "log" | "plugin_artifact" | "runtime_state" | "secret" | "session" | "symlink";

export interface EnvironmentAuditEntry {
  auditVersion: 1;
  operation: "copy" | "import" | "backup" | "restore" | "template_create" | "template_apply";
  sourceEnvironmentId?: string;
  targetEnvironmentId: string;
  sourceConfigHash: string;
  targetConfigHash: string;
  skipped: Partial<Record<EnvironmentExcludedPathCategory, number>>;
  operator: "local";
  timestamp: string;
  result: "succeeded";
}

interface ConfigCopyResult {
  sourceConfigHash: string;
  targetConfigHash: string;
  skipped: Partial<Record<EnvironmentExcludedPathCategory, number>>;
}

export interface EnvironmentStatus {
  environment: AgentEnvironment;
  manifest?: EnvironmentManifest;
  currentHash?: string;
  readiness: "ready" | "drifted" | "invalid";
  drifted: boolean;
  healthy: boolean;
  issues: string[];
}

export interface EnvironmentRunLock {
  environmentId: string;
  runId: string;
  configHash: string;
  release(): void;
}

interface ActiveEnvironmentRuns {
  configHash: string;
  runIds: Set<string>;
}

const activeEnvironmentRuns = new Map<string, ActiveEnvironmentRuns>();

export interface EnvironmentBackup {
  id: string;
  environmentId: string;
  createdAt: string;
  configHash: string;
  path: string;
}

/**
 * A config-only local archive. Templates deliberately live outside the config
 * schema: they are immutable filesystem artifacts rather than shared global
 * entities, so they cannot accidentally contain resolved secret values.
 */
export interface EnvironmentTemplate {
  templateVersion: 1;
  id: string;
  sourceEnvironmentId: string;
  engineId?: string;
  engineVersion?: string;
  createdAt: string;
  configHash: string;
  skipped: Partial<Record<EnvironmentExcludedPathCategory, number>>;
}

export class EnvironmentManagerError extends AgentDockError {
  public constructor(
    code: "ENVIRONMENT_NOT_FOUND" | "ENVIRONMENT_DIRECTORY_INVALID" | "ENVIRONMENT_MANIFEST_INVALID" | "ENVIRONMENT_BACKUP_NOT_FOUND" | "ENVIRONMENT_EXTERNAL_CONFIRMATION_REQUIRED" | "ENVIRONMENT_RESCAN_REQUIRED" | "ENVIRONMENT_RUN_IN_PROGRESS" | "ENVIRONMENT_TEMPLATE_NOT_FOUND" | "ENVIRONMENT_TEMPLATE_EXISTS" | "ENVIRONMENT_TEMPLATE_INVALID" | "ENVIRONMENT_TEMPLATE_INTEGRITY_FAILED",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code, message);
    this.name = "EnvironmentManagerError";
  }
}

export function environmentControlRoot(config: AgentDockConfig, baseDirectory: string): string {
  if (!config.dataDir) return resolveConfiguredPath(baseDirectory, ".agentdock");
  const configured = resolveConfiguredPath(baseDirectory, config.dataDir);
  if (existsSync(configured) && statSync(configured).isFile()) return dirnameConfigured(configured);
  return basenameConfigured(configured).toLowerCase() === "data" ? dirnameConfigured(configured) : configured;
}

export function environmentManifestPath(config: AgentDockConfig, baseDirectory: string, environmentId: string): string {
  return joinConfigured(environmentControlRoot(config, baseDirectory), "environments", environmentId, MANIFEST_NAME);
}

/** A redacted operation log; it records categories and counts, never file paths or values. */
export function environmentAuditLogPath(config: AgentDockConfig, baseDirectory: string): string {
  return joinConfigured(environmentControlRoot(config, baseDirectory), "environment-audit.jsonl");
}

export function environmentTemplateRoot(config: AgentDockConfig, baseDirectory: string): string {
  return joinConfigured(environmentControlRoot(config, baseDirectory), "environment-templates");
}

export function resolveEnvironmentDirectories(
  config: AgentDockConfig,
  baseDirectory: string,
  environment: ConfigEnvironment,
): ResolvedEnvironmentDirectories {
  const root = joinConfigured(environmentControlRoot(config, baseDirectory), "environments", environment.id);
  if (environment.directoryMode === "managed") {
    const directories = {
      configDir: environment.homeDir ? resolveConfiguredHome(baseDirectory, environment.homeDir) : environment.configDir ? resolveConfiguredPath(baseDirectory, environment.configDir) : joinConfigured(root, "config"),
      stateDir: environment.stateDir ? resolveConfiguredPath(baseDirectory, environment.stateDir) : joinConfigured(root, "state"),
      cacheDir: environment.cacheDir ? resolveConfiguredPath(baseDirectory, environment.cacheDir) : joinConfigured(root, "cache"),
    };
    for (const [kind, path] of Object.entries(directories)) {
      if (!isWithin(path, root)) {
        throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", `Managed ${kind} must stay inside "${root}".`, { path, root });
      }
    }
    return directories;
  }
  if (!environment.homeDir && !environment.configDir) {
    throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", `External Environment "${environment.id}" requires homeDir.`);
  }
  const externalHome = environment.homeDir ?? environment.configDir;
  return {
    configDir: resolveConfiguredHome(baseDirectory, externalHome as string),
    stateDir: environment.stateDir ? resolveConfiguredPath(baseDirectory, environment.stateDir) : joinConfigured(root, "state"),
    cacheDir: environment.cacheDir ? resolveConfiguredPath(baseDirectory, environment.cacheDir) : joinConfigured(root, "cache"),
  };
}

function resolveConfiguredHome(baseDirectory: string, configured: string): string {
  const homeDirectory = process.env.USERPROFILE ?? process.env.HOME ?? baseDirectory;
  const expanded = configured === "~" ? homeDirectory : configured.startsWith("~/") || configured.startsWith("~\\") ? joinConfigured(homeDirectory, configured.slice(2)) : configured;
  return resolveConfiguredPath(baseDirectory, expanded);
}

export function readEnvironmentManifestSync(config: AgentDockConfig, baseDirectory: string, environmentId: string): EnvironmentManifest | undefined {
  const path = environmentManifestPath(config, baseDirectory, environmentId);
  if (!existsSync(path)) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as EnvironmentManifest;
    if (manifest.manifestVersion !== 1 || manifest.environmentId !== environmentId || typeof manifest.configHash !== "string") {
      throw new Error("manifest fields are invalid");
    }
    return manifest;
  } catch (error) {
    throw new EnvironmentManagerError("ENVIRONMENT_MANIFEST_INVALID", `Could not read Environment manifest "${path}": ${String(error)}`);
  }
}

export class EnvironmentDirectoryManager {
  private readonly rescanOperations = new Map<string, Promise<EnvironmentManifest>>();

  public constructor(
    private readonly config: AgentDockConfig,
    private readonly baseDirectory: string,
  ) {}

  public async list(): Promise<EnvironmentStatus[]> {
    const output: EnvironmentStatus[] = [];
    for (const environment of environmentCatalog(this.config).environments) output.push(await this.inspect(environment.id));
    return output;
  }

  public async inspect(environmentId: string): Promise<EnvironmentStatus> {
    const environment = this.requireEnvironment(environmentId);
    const directories = resolveEnvironmentDirectories(this.config, this.baseDirectory, environment);
    const normalized: AgentEnvironment = toAgentEnvironment(environment, directories);
    const issues: string[] = [];
    if (!existsSync(directories.configDir as string)) issues.push(`configDir does not exist: ${directories.configDir}`);
    let currentHash: string | undefined;
    if (issues.length === 0) {
      try { currentHash = await hashConfigDirectory(directories.configDir as string); }
      catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
    }
    let manifest: EnvironmentManifest | undefined;
    try { manifest = readEnvironmentManifestSync(this.config, this.baseDirectory, environmentId); }
    catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
    const drifted = Boolean(manifest && currentHash && manifest.configHash !== currentHash);
    return {
      environment: normalized,
      ...(manifest ? { manifest } : {}),
      ...(currentHash ? { currentHash } : {}),
      readiness: issues.length > 0 ? "invalid" : drifted ? "drifted" : manifest ? "ready" : "invalid",
      drifted,
      healthy: issues.length === 0,
      issues,
    };
  }

  /**
   * Establishes the one allowed implicit manifest write: initial creation of a
   * managed Environment. Existing, external, and drifted directories must be
   * explicitly rescanned so external edits cannot silently enter a Run.
   */
  public async prepareForRun(environmentId: string): Promise<EnvironmentManifest> {
    const environment = this.requireEnvironment(environmentId);
    const status = await this.inspect(environmentId);
    if (status.drifted) {
      throw new EnvironmentManagerError("ENVIRONMENT_RESCAN_REQUIRED", `Environment "${environmentId}" changed outside AgentDock. Run environment rescan before executing.`, {
        ...(status.manifest ? { manifestConfigHash: status.manifest.configHash, lastScannedAt: status.manifest.scannedAt } : {}),
        ...(status.currentHash ? { currentConfigHash: status.currentHash } : {}),
      });
    }
    if (status.manifest && status.healthy) return status.manifest;

    const directories = resolveEnvironmentDirectories(this.config, this.baseDirectory, environment);
    if (!status.manifest && environment.directoryMode === "managed" && !existsSync(directories.configDir as string)) {
      return this.rescan(environmentId);
    }
    if (!status.manifest && status.healthy) {
      throw new EnvironmentManagerError("ENVIRONMENT_RESCAN_REQUIRED", `Environment "${environmentId}" has not been explicitly scanned. Run environment rescan before executing.`);
    }
    throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", status.issues.join("; ") || `Environment "${environmentId}" is not ready.`);
  }

  /**
   * Registers a Run against a native Environment. Concurrent Runs are allowed
   * only while they share the same confirmed manifest; reconcile waits until
   * the last holder so a concurrent Run cannot be mistaken for an external
   * edit.
   */
  public acquireRunLock(environmentId: string, runId: string, configHash: string): EnvironmentRunLock {
    const key = environmentManifestPath(this.config, this.baseDirectory, environmentId);
    const existing = activeEnvironmentRuns.get(key);
    if (existing && existing.configHash !== configHash) {
      throw new EnvironmentManagerError("ENVIRONMENT_RUN_IN_PROGRESS", `Environment "${environmentId}" is already executing against a different confirmed configuration. Wait for it to finish before starting another Run.`);
    }
    const active = existing ?? { configHash, runIds: new Set<string>() };
    active.runIds.add(runId);
    activeEnvironmentRuns.set(key, active);
    let released = false;
    return {
      environmentId,
      runId,
      configHash,
      release: (): void => {
        if (released) return;
        released = true;
        if (activeEnvironmentRuns.get(key) !== active) return;
        active.runIds.delete(runId);
        if (active.runIds.size === 0) activeEnvironmentRuns.delete(key);
      },
    };
  }

  public rescan(environmentId: string): Promise<EnvironmentManifest> {
    const existing = this.rescanOperations.get(environmentId);
    if (existing) return existing;
    const operation = this.rescanInternal(environmentId);
    this.rescanOperations.set(environmentId, operation);
    void operation.then(() => {
      if (this.rescanOperations.get(environmentId) === operation) this.rescanOperations.delete(environmentId);
    }, () => {
      if (this.rescanOperations.get(environmentId) === operation) this.rescanOperations.delete(environmentId);
    });
    return operation;
  }

  /**
   * Runtime processes may update their own home with caches and state while a
   * Run is active. Reconcile those changes after the Run has finished, while
   * keeping the pre-run drift check strict for changes made while idle.
   */
  public async reconcileAfterRun(environmentId: string, expectedConfigHash?: string, runId?: string): Promise<boolean> {
    const key = environmentManifestPath(this.config, this.baseDirectory, environmentId);
    const active = activeEnvironmentRuns.get(key);
    if (!runId || !expectedConfigHash || !active?.runIds.has(runId) || active.configHash !== expectedConfigHash || active.runIds.size !== 1) return false;
    const status = await this.inspect(environmentId);
    if (!status.healthy) throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", status.issues.join("; "));
    // A newer manifest means another explicit rescan won the race. Leave it
    // intact instead of classifying a concurrent external edit as Run output.
    if (status.drifted && status.manifest && status.manifest.configHash === expectedConfigHash) {
      await this.rescan(environmentId);
      return true;
    }
    return false;
  }

  private async rescanInternal(environmentId: string): Promise<EnvironmentManifest> {
    const environment = this.requireEnvironment(environmentId);
    const directories = resolveEnvironmentDirectories(this.config, this.baseDirectory, environment);
    if (environment.directoryMode === "managed") {
      await Promise.all([mkdir(directories.configDir as string, { recursive: true }), mkdir(directories.stateDir as string, { recursive: true }), mkdir(directories.cacheDir as string, { recursive: true })]);
    } else {
      await assertDirectory(directories.configDir as string, "configDir");
      // Omitted external state/cache paths are AgentDock-managed and may be created safely.
      if (!environment.stateDir) await mkdir(directories.stateDir as string, { recursive: true });
      else await assertDirectory(directories.stateDir as string, "stateDir");
      if (!environment.cacheDir) await mkdir(directories.cacheDir as string, { recursive: true });
      else await assertDirectory(directories.cacheDir as string, "cacheDir");
    }
    const manifest: EnvironmentManifest = {
      manifestVersion: 1,
      environmentId,
      ...(environment.engineId ? { engineId: environment.engineId } : {}),
      directoryMode: environment.directoryMode,
      configDir: directories.configDir as string,
      stateDir: directories.stateDir as string,
      cacheDir: directories.cacheDir as string,
      ...(environment.homeDir ? { homeDir: directories.configDir as string } : {}),
      configHash: await hashConfigDirectory(directories.configDir as string),
      scannedAt: new Date().toISOString(),
    };
    await atomicJsonWrite(environmentManifestPath(this.config, this.baseDirectory, environmentId), manifest);
    return manifest;
  }

  public async copyConfig(sourceEnvironmentId: string, targetEnvironmentId: string): Promise<void> {
    const source = resolveEnvironmentDirectories(this.config, this.baseDirectory, this.requireEnvironment(sourceEnvironmentId));
    const targetEnvironment = this.requireEnvironment(targetEnvironmentId);
    if (targetEnvironment.directoryMode !== "managed") throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", "A copied Environment must use managed directories.");
    const target = resolveEnvironmentDirectories(this.config, this.baseDirectory, targetEnvironment);
    await assertDirectory(source.configDir as string, "source configDir");
    if (existsSync(target.configDir as string)) throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", `Target configDir already exists: ${target.configDir}. Choose a new Environment ID or reuse the existing directory.`);
    const copied = await copyConfigDirectory(source.configDir as string, target.configDir as string);
    await this.rescan(targetEnvironmentId);
    await this.appendAudit({
      operation: "copy",
      sourceEnvironmentId,
      targetEnvironmentId,
      ...copied,
    });
  }

  public async importConfig(sourceConfigDir: string, targetEnvironmentId: string): Promise<void> {
    const source = isConfiguredAbsolute(sourceConfigDir) ? sourceConfigDir : resolveConfiguredPath(this.baseDirectory, sourceConfigDir);
    await assertDirectory(source, "sourceConfigDir");
    const targetEnvironment = this.requireEnvironment(targetEnvironmentId);
    if (targetEnvironment.directoryMode !== "managed") throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", "Importing a config-only Environment requires managed directories. Create an external Environment directly to reference an existing native home.");
    const target = resolveEnvironmentDirectories(this.config, this.baseDirectory, targetEnvironment);
    if (existsSync(target.configDir as string)) throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", `Target configDir already exists: ${target.configDir}. Choose a new Environment ID or reuse the existing directory.`);
    const copied = await copyConfigDirectory(source, target.configDir as string);
    await this.rescan(targetEnvironmentId);
    await this.appendAudit({
      operation: "import",
      targetEnvironmentId,
      ...copied,
    });
  }

  public async backup(environmentId: string): Promise<EnvironmentBackup> {
    const environment = this.requireEnvironment(environmentId);
    const directories = resolveEnvironmentDirectories(this.config, this.baseDirectory, environment);
    await assertDirectory(directories.configDir as string, "configDir");
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    const root = joinConfigured(environmentControlRoot(this.config, this.baseDirectory), "environment-backups", environmentId, id);
    const staging = `${root}.creating-${randomUUID()}`;
    try {
      const copied = await copyFilteredConfigDirectory(directories.configDir as string, joinConfigured(staging, "config"));
      const backup: EnvironmentBackup = { id, environmentId, createdAt: new Date().toISOString(), configHash: copied.sourceConfigHash, path: root };
      await atomicJsonWrite(joinConfigured(staging, "backup.json"), backup);
      await rename(staging, root);
      await this.appendAudit({
        operation: "backup",
        sourceEnvironmentId: environmentId,
        targetEnvironmentId: environmentId,
        ...copied,
      });
      return backup;
    } catch (error) {
      try { await rm(staging, { recursive: true, force: true }); } catch { /* Best-effort cleanup of an incomplete backup. */ }
      throw error;
    }
  }

  public async backups(environmentId: string): Promise<EnvironmentBackup[]> {
    this.requireEnvironment(environmentId);
    const root = joinConfigured(environmentControlRoot(this.config, this.baseDirectory), "environment-backups", environmentId);
    if (!existsSync(root)) return [];
    const entries = await readdir(root, { withFileTypes: true });
    const backups: EnvironmentBackup[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try { backups.push(JSON.parse(await readFile(joinConfigured(root, entry.name, "backup.json"), "utf8")) as EnvironmentBackup); } catch { /* Ignore incomplete backups. */ }
    }
    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Creates one immutable config-only archive from a confirmed Environment. */
  public async createTemplate(templateId: string, sourceEnvironmentId: string): Promise<EnvironmentTemplate> {
    assertTemplateId(templateId);
    const sourceEnvironment = this.requireEnvironment(sourceEnvironmentId);
    const sourceStatus = await this.inspect(sourceEnvironmentId);
    if (sourceStatus.readiness !== "ready") {
      if (sourceStatus.healthy) {
        throw new EnvironmentManagerError("ENVIRONMENT_RESCAN_REQUIRED", `Environment "${sourceEnvironmentId}" must be ready before creating a template. Run environment rescan first.`, {
          ...(sourceStatus.manifest ? { manifestConfigHash: sourceStatus.manifest.configHash, lastScannedAt: sourceStatus.manifest.scannedAt } : {}),
          ...(sourceStatus.currentHash ? { currentConfigHash: sourceStatus.currentHash } : {}),
        });
      }
      throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", sourceStatus.issues.join("; ") || `Environment "${sourceEnvironmentId}" is not ready.`);
    }
    const root = this.templatePath(templateId);
    if (existsSync(root)) throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_EXISTS", `Environment template "${templateId}" already exists.`);
    const staging = `${root}.creating-${randomUUID()}`;
    try {
      const source = resolveEnvironmentDirectories(this.config, this.baseDirectory, sourceEnvironment).configDir as string;
      const copied = await copyFilteredConfigDirectory(source, joinConfigured(staging, "config"));
      await assertConfigOnlyArchive(joinConfigured(staging, "config"));
      if (copied.sourceConfigHash !== sourceStatus.manifest?.configHash) {
        throw new EnvironmentManagerError("ENVIRONMENT_RESCAN_REQUIRED", `Environment "${sourceEnvironmentId}" changed while its template was being created. Run environment rescan and retry.`);
      }
      const engine = sourceEnvironment.engineId ? environmentCatalog(this.config).engines.find((item) => item.id === sourceEnvironment.engineId) : undefined;
      const template: EnvironmentTemplate = {
        templateVersion: 1,
        id: templateId,
        sourceEnvironmentId,
        ...(sourceEnvironment.engineId ? { engineId: sourceEnvironment.engineId } : {}),
        ...(engine?.version ? { engineVersion: engine.version } : {}),
        createdAt: new Date().toISOString(),
        configHash: copied.sourceConfigHash,
        skipped: copied.skipped,
      };
      await atomicJsonWrite(joinConfigured(staging, TEMPLATE_METADATA_NAME), template);
      await rename(staging, root);
      await this.appendAudit({
        operation: "template_create",
        sourceEnvironmentId,
        targetEnvironmentId: sourceEnvironmentId,
        ...copied,
      });
      return template;
    } catch (error) {
      try { await rm(staging, { recursive: true, force: true }); } catch { /* Best-effort cleanup of an incomplete template. */ }
      throw error;
    }
  }

  /** Lists valid, complete immutable archives. Incomplete or malformed entries are never exposed as templates. */
  public async templates(): Promise<EnvironmentTemplate[]> {
    const root = environmentTemplateRoot(this.config, this.baseDirectory);
    if (!existsSync(root)) return [];
    const entries = await readdir(root, { withFileTypes: true });
    const templates: EnvironmentTemplate[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        templates.push(parseEnvironmentTemplate(JSON.parse(await readFile(joinConfigured(root, entry.name, TEMPLATE_METADATA_NAME), "utf8")) as unknown, entry.name));
      } catch {
        // A failed creation or a manually corrupted archive is not usable.
      }
    }
    return templates.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /**
   * Applies a template to a new configured managed Environment. The caller is
   * responsible for adding the target Environment configuration atomically;
   * this method intentionally refuses existing config directories.
   */
  public async applyTemplate(templateId: string, targetEnvironmentId: string): Promise<EnvironmentManifest> {
    const template = await this.readTemplate(templateId);
    const targetEnvironment = this.requireEnvironment(targetEnvironmentId);
    if (targetEnvironment.directoryMode !== "managed") {
      throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", "A template can only create a managed Environment.");
    }
    const target = resolveEnvironmentDirectories(this.config, this.baseDirectory, targetEnvironment);
    if (existsSync(target.configDir as string)) {
      throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", `Target configDir already exists: ${target.configDir}. Choose a new Environment ID or reuse the existing directory.`);
    }
    const source = joinConfigured(this.templatePath(templateId), "config");
    await assertDirectory(source, "template config");
    await assertConfigOnlyArchive(source);
    const archiveHash = await hashConfigDirectory(source);
    if (archiveHash !== template.configHash) {
      throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_INTEGRITY_FAILED", `Environment template "${templateId}" failed config hash verification.`);
    }
    const copied = await copyConfigDirectory(source, target.configDir as string);
    if (copied.sourceConfigHash !== template.configHash || copied.targetConfigHash !== template.configHash) {
      throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_INTEGRITY_FAILED", `Environment template "${templateId}" failed config copy verification.`);
    }
    const manifest = await this.rescan(targetEnvironmentId);
    await this.appendAudit({
      operation: "template_apply",
      sourceEnvironmentId: template.sourceEnvironmentId,
      targetEnvironmentId,
      ...copied,
    });
    return manifest;
  }

  public async restore(environmentId: string, backupId: string, confirmExternal = false): Promise<EnvironmentManifest> {
    const environment = this.requireEnvironment(environmentId);
    if (environment.directoryMode === "external" && !confirmExternal) {
      throw new EnvironmentManagerError("ENVIRONMENT_EXTERNAL_CONFIRMATION_REQUIRED", "Restoring into an external configDir requires explicit confirmation.");
    }
    const backup = (await this.backups(environmentId)).find((item) => item.id === backupId);
    if (!backup) throw new EnvironmentManagerError("ENVIRONMENT_BACKUP_NOT_FOUND", `Environment backup "${backupId}" was not found.`);
    const source = joinConfigured(backup.path, "config");
    await assertDirectory(source, "backup config");
    const target = resolveEnvironmentDirectories(this.config, this.baseDirectory, environment).configDir as string;
    if (existsSync(target)) await this.backup(environmentId);
    const staging = `${target}.restore-${randomUUID()}`;
    const previous = `${target}.previous-${randomUUID()}`;
    let copied: ConfigCopyResult;
    try {
      copied = await copyFilteredConfigDirectory(source, staging);
      if (existsSync(target)) await rename(target, previous);
      await rename(staging, target);
      if (existsSync(previous)) await rm(previous, { recursive: true, force: true });
    } catch (error) {
      if (existsSync(staging)) await rm(staging, { recursive: true, force: true });
      if (!existsSync(target) && existsSync(previous)) await rename(previous, target);
      throw error;
    }
    const manifest = await this.rescan(environmentId);
    await this.appendAudit({
      operation: "restore",
      sourceEnvironmentId: environmentId,
      targetEnvironmentId: environmentId,
      ...copied,
    });
    return manifest;
  }

  private async appendAudit(input: Omit<EnvironmentAuditEntry, "auditVersion" | "operator" | "timestamp" | "result" | "sourceConfigHash" | "targetConfigHash" | "skipped"> & ConfigCopyResult): Promise<void> {
    const entry: EnvironmentAuditEntry = {
      auditVersion: 1,
      operation: input.operation,
      ...(input.sourceEnvironmentId ? { sourceEnvironmentId: input.sourceEnvironmentId } : {}),
      targetEnvironmentId: input.targetEnvironmentId,
      sourceConfigHash: input.sourceConfigHash,
      targetConfigHash: input.targetConfigHash,
      skipped: input.skipped,
      operator: "local",
      timestamp: new Date().toISOString(),
      result: "succeeded",
    };
    const path = environmentAuditLogPath(this.config, this.baseDirectory);
    await mkdir(dirnameConfigured(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private requireEnvironment(environmentId: string): ConfigEnvironment {
    const environment = environmentCatalog(this.config).environments.find((item) => item.id === environmentId);
    if (!environment) throw new EnvironmentManagerError("ENVIRONMENT_NOT_FOUND", `Environment "${environmentId}" was not found.`);
    return environment;
  }

  private templatePath(templateId: string): string {
    assertTemplateId(templateId);
    return joinConfigured(environmentTemplateRoot(this.config, this.baseDirectory), templateId);
  }

  private async readTemplate(templateId: string): Promise<EnvironmentTemplate> {
    assertTemplateId(templateId);
    const root = this.templatePath(templateId);
    if (!existsSync(root)) throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_NOT_FOUND", `Environment template "${templateId}" was not found.`);
    try {
      return parseEnvironmentTemplate(JSON.parse(await readFile(joinConfigured(root, TEMPLATE_METADATA_NAME), "utf8")) as unknown, templateId);
    } catch (error) {
      if (error instanceof EnvironmentManagerError) throw error;
      throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_INVALID", `Environment template "${templateId}" metadata is invalid.`);
    }
  }
}

interface ResolvedEnvironmentDirectories {
  configDir: string;
  stateDir: string;
  cacheDir: string;
}

function toAgentEnvironment(environment: ConfigEnvironment, directories: ResolvedEnvironmentDirectories): AgentEnvironment {
  return {
    id: environment.id,
    ...(environment.engineId ? { engineId: environment.engineId } : {}),
    ...(environment.permissionId ? { permissionId: environment.permissionId } : {}),
    ...(environment.extends ? { extends: environment.extends } : {}),
    directoryMode: environment.directoryMode,
    homeDir: directories.configDir,
    configDir: directories.configDir,
    stateDir: directories.stateDir,
    cacheDir: directories.cacheDir,
    launchArgs: environment.launchArgs,
    settings: environment.settings,
  };
}

export async function hashConfigDirectory(directory: string): Promise<string> {
  await assertDirectory(directory, "configDir");
  const hash = createHash("sha256");
  let files = 0;
  let bytes = 0;
  const visit = async (current: string, prefix: string): Promise<void> => {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(current, entry.name);
      if (shouldSkipConfigPath(directory, fullPath)) continue;
      if (entry.isSymbolicLink()) {
        files += 1;
        hash.update(`L\0${relativePath}\0${await readlink(fullPath)}\0`);
      } else if (entry.isDirectory()) {
        hash.update(`D\0${relativePath}\0`);
        await visit(fullPath, relativePath);
      } else if (entry.isFile()) {
        const info = await stat(fullPath);
        files += 1;
        bytes += info.size;
        if (files > MAX_CONFIG_FILES || bytes > MAX_CONFIG_BYTES) throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", "configDir exceeds the scan limit.");
        hash.update(`F\0${relativePath}\0${info.size}\0`);
        hash.update(await readFile(fullPath));
      }
    }
  };
  await visit(directory, "");
  return hash.digest("hex");
}

function shouldSkipConfigPath(sourceRoot: string, candidate: string): boolean {
  return classifyConfigPath(sourceRoot, candidate).category !== undefined;
}

function classifyConfigPath(sourceRoot: string, candidate: string): { category?: EnvironmentExcludedPathCategory } {
  const relativePath = relativeConfigured(sourceRoot, candidate);
  if (!relativePath || relativePath.startsWith("..") || isConfiguredAbsolute(relativePath)) return {};
  try {
    if (lstatSync(candidate).isSymbolicLink()) return { category: "symlink" };
  } catch {
    // Let the copy or scan report a disappearing path as an ordinary I/O error.
  }
  const parts = relativePath.split(/[\\/]+/u).map((part) => part.toLowerCase());
  const root = parts[0] ?? "";
  const leaf = parts.at(-1) ?? "";
  if (root === "plugins" && IGNORED_PLUGIN_ROOTS.has(parts[1] ?? "")) return { category: "plugin_artifact" };
  if (root === "cache" || leaf === "models_cache.json") return { category: "cache" };
  if (root === "logs" || root === "log" || leaf.endsWith(".log")) return { category: "log" };
  if (root === "sessions" || root === "archived_sessions" || root === "history" || leaf === "history.jsonl" || leaf === "session_index.jsonl" || leaf === "transcription-history.jsonl") return { category: "session" };
  if (root === "state" || root === "browser" || root === "tmp" || root === ".tmp" || root === "attachments" || root === "backups" || root === "visualizations" || root === "node_repl" || root === ".sandbox" || root === ".sandbox-bin" || root === ".sandbox-secrets" || root === "process_manager" || root === "thread-writer-locks" || root === "mcp-oauth-locks" || root === "dictation-history" || root === "computer-use" || root === "pets" || root === "memories" || root === "ambient-suggestions") return { category: "runtime_state" };
  if (root === "sqlite" || /\.sqlite(?:-(?:wal|shm))?$/u.test(leaf)) return { category: "database" };
  if (IGNORED_CONFIG_FILES.has(leaf) || leaf.startsWith(".env.") || parts.some((part) => SENSITIVE_NAME_MARKERS.some((marker) => part.replace(/[^a-z0-9]/gu, "").includes(marker)))) return { category: "secret" };
  // Keep this final guard explicit so adding a known root never silently makes it copyable.
  if (IGNORED_CONFIG_ROOTS.has(root)) return { category: "runtime_state" };
  return {};
}

async function copyConfigDirectory(source: string, target: string): Promise<ConfigCopyResult> {
  await mkdir(dirnameConfigured(target), { recursive: true });
  const staging = joinConfigured(dirnameConfigured(target), `.${basenameConfigured(target)}.copy-${randomUUID()}`);
  try {
    const copied = await copyFilteredConfigDirectory(source, staging);
    await rename(staging, target);
    return copied;
  } catch (error) {
    try { await rm(staging, { recursive: true, force: true }); } catch { /* Best-effort cleanup of a failed copy. */ }
    throw error;
  }
}

async function copyFilteredConfigDirectory(source: string, target: string): Promise<ConfigCopyResult> {
  await assertDirectory(source, "source configDir");
  await mkdir(dirnameConfigured(target), { recursive: true });
  const skipped: Partial<Record<EnvironmentExcludedPathCategory, number>> = {};
  const filter = (candidate: string): boolean => {
    const category = classifyConfigPath(source, candidate).category;
    if (!category) return true;
    skipped[category] = (skipped[category] ?? 0) + 1;
    return false;
  };
  const sourceConfigHash = await hashConfigDirectory(source);
  await cp(source, target, { recursive: true, force: false, errorOnExist: true, dereference: true, filter });
  const targetConfigHash = await hashConfigDirectory(target);
  if (sourceConfigHash !== targetConfigHash) {
    throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", "Config-only copy integrity verification failed.");
  }
  return { sourceConfigHash, targetConfigHash, skipped };
}

async function assertConfigOnlyArchive(root: string): Promise<void> {
  await assertDirectory(root, "template config");
  const categories = new Set<EnvironmentExcludedPathCategory>();
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const candidate = joinConfigured(current, entry.name);
      const category = classifyConfigPath(root, candidate).category;
      if (category) {
        categories.add(category);
        continue;
      }
      if (entry.isDirectory()) await visit(candidate);
    }
  };
  await visit(root);
  if (categories.size > 0) {
    throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_INTEGRITY_FAILED", "Environment template contains excluded config categories.", { categories: [...categories].sort() });
  }
}

function assertTemplateId(templateId: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(templateId)) {
    throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_INVALID", "Template id must be a lowercase identifier.");
  }
}

function parseEnvironmentTemplate(input: unknown, expectedId: string): EnvironmentTemplate {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_INVALID", `Environment template "${expectedId}" metadata is invalid.`);
  }
  const value = input as Record<string, unknown>;
  if (value.templateVersion !== 1 || value.id !== expectedId || typeof value.sourceEnvironmentId !== "string" || typeof value.createdAt !== "string" || typeof value.configHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.configHash)) {
    throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_INVALID", `Environment template "${expectedId}" metadata is invalid.`);
  }
  assertTemplateId(expectedId);
  assertTemplateId(value.sourceEnvironmentId);
  if ((value.engineId !== undefined && typeof value.engineId !== "string") || (value.engineVersion !== undefined && typeof value.engineVersion !== "string") || !isSkippedCategoryRecord(value.skipped)) {
    throw new EnvironmentManagerError("ENVIRONMENT_TEMPLATE_INVALID", `Environment template "${expectedId}" metadata is invalid.`);
  }
  return {
    templateVersion: 1,
    id: expectedId,
    sourceEnvironmentId: value.sourceEnvironmentId,
    ...(typeof value.engineId === "string" ? { engineId: value.engineId } : {}),
    ...(typeof value.engineVersion === "string" ? { engineVersion: value.engineVersion } : {}),
    createdAt: value.createdAt,
    configHash: value.configHash,
    skipped: value.skipped,
  };
}

function isSkippedCategoryRecord(value: unknown): value is Partial<Record<EnvironmentExcludedPathCategory, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const known = new Set<EnvironmentExcludedPathCategory>(["cache", "database", "log", "plugin_artifact", "runtime_state", "secret", "session", "symlink"]);
  return Object.entries(value).every(([category, count]) => known.has(category as EnvironmentExcludedPathCategory) && typeof count === "number" && Number.isSafeInteger(count) && count > 0);
}

async function assertDirectory(path: string, label: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", `${label} is not an accessible directory: ${path}`, { cause: String(error) });
  }
}

async function atomicJsonWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function resolveConfiguredPath(baseDirectory: string, configuredPath: string): string {
  return usesWindowsPath(baseDirectory) || usesWindowsPath(configuredPath) ? win32.resolve(baseDirectory, configuredPath) : resolve(baseDirectory, configuredPath);
}

function joinConfigured(basePath: string, ...segments: string[]): string {
  return usesWindowsPath(basePath) ? win32.join(basePath, ...segments) : join(basePath, ...segments);
}

function dirnameConfigured(path: string): string {
  return usesWindowsPath(path) ? win32.dirname(path) : dirname(path);
}

function basenameConfigured(path: string): string {
  return usesWindowsPath(path) ? win32.basename(path) : basename(path);
}

function relativeConfigured(from: string, to: string): string {
  return usesWindowsPath(from) || usesWindowsPath(to) ? win32.relative(from, to) : relative(from, to);
}

function isConfiguredAbsolute(path: string): boolean {
  return usesWindowsPath(path) ? win32.isAbsolute(path) : isAbsolute(path);
}

function isWithin(candidate: string, root: string): boolean {
  const pathModule = usesWindowsPath(candidate) || usesWindowsPath(root) ? win32 : { relative, isAbsolute };
  const path = pathModule.relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !pathModule.isAbsolute(path));
}

function usesWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\");
}
