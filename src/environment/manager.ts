import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import type { AgentDockConfig, ConfigEnvironment } from "../config/schema.js";
import { environmentCatalog } from "../config/model.js";
import type { AgentEnvironment, EnvironmentManifest } from "../core/types.js";

const MANIFEST_NAME = "manifest.json";
const MAX_CONFIG_FILES = 10_000;
const MAX_CONFIG_BYTES = 64 * 1024 * 1024;
const IGNORED_CONFIG_ROOTS = new Set(["cache", "logs", "browser", "tmp", ".tmp", "attachments", "backups", "sessions", "archived_sessions", "visualizations", "sqlite", ".sandbox", ".sandbox-bin", ".sandbox-secrets", "process_manager", "thread-writer-locks", "mcp-oauth-locks", "dictation-history", "computer-use", "pets", "memories", "ambient-suggestions"]);
const IGNORED_PLUGIN_ROOTS = new Set(["cache", "node_modules", "data", "prebuilds", ".plugin-appserver", ".marketplace-plugin-source-staging"]);

export interface EnvironmentStatus {
  environment: AgentEnvironment;
  manifest?: EnvironmentManifest;
  currentHash?: string;
  drifted: boolean;
  healthy: boolean;
  issues: string[];
}

export interface EnvironmentBackup {
  id: string;
  environmentId: string;
  createdAt: string;
  configHash: string;
  path: string;
}

export class EnvironmentManagerError extends Error {
  public constructor(
    public readonly code: "ENVIRONMENT_NOT_FOUND" | "ENVIRONMENT_DIRECTORY_INVALID" | "ENVIRONMENT_MANIFEST_INVALID" | "ENVIRONMENT_BACKUP_NOT_FOUND" | "ENVIRONMENT_EXTERNAL_CONFIRMATION_REQUIRED",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
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
    return {
      environment: normalized,
      ...(manifest ? { manifest } : {}),
      ...(currentHash ? { currentHash } : {}),
      drifted: Boolean(manifest && currentHash && manifest.configHash !== currentHash),
      healthy: issues.length === 0,
      issues,
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
    await mkdir(dirname(target.configDir), { recursive: true });
    await cp(source.configDir as string, target.configDir as string, { recursive: true, force: false, errorOnExist: true, dereference: true, filter: (candidate) => !shouldSkipConfigPath(source.configDir as string, candidate) });
    await this.rescan(targetEnvironmentId);
  }

  public async importConfig(sourceConfigDir: string, targetEnvironmentId: string): Promise<void> {
    const source = isConfiguredAbsolute(sourceConfigDir) ? sourceConfigDir : resolveConfiguredPath(this.baseDirectory, sourceConfigDir);
    await assertDirectory(source, "sourceConfigDir");
    const targetEnvironment = this.requireEnvironment(targetEnvironmentId);
    if (targetEnvironment.directoryMode === "managed") {
      const target = resolveEnvironmentDirectories(this.config, this.baseDirectory, targetEnvironment);
      if (existsSync(target.configDir as string)) throw new EnvironmentManagerError("ENVIRONMENT_DIRECTORY_INVALID", `Target configDir already exists: ${target.configDir}. Choose a new Environment ID or reuse the existing directory.`);
      await mkdir(dirnameConfigured(target.configDir), { recursive: true });
      await cp(source, target.configDir as string, { recursive: true, force: false, errorOnExist: true, dereference: true, filter: (candidate) => !shouldSkipConfigPath(source, candidate) });
    }
    await this.rescan(targetEnvironmentId);
  }

  public async backup(environmentId: string): Promise<EnvironmentBackup> {
    const environment = this.requireEnvironment(environmentId);
    const directories = resolveEnvironmentDirectories(this.config, this.baseDirectory, environment);
    await assertDirectory(directories.configDir as string, "configDir");
    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    const root = joinConfigured(environmentControlRoot(this.config, this.baseDirectory), "environment-backups", environmentId, id);
    await mkdir(root, { recursive: true });
    await cp(directories.configDir as string, joinConfigured(root, "config"), { recursive: true, force: false, errorOnExist: true, dereference: true, filter: (candidate) => !shouldSkipConfigPath(directories.configDir as string, candidate) });
    const backup: EnvironmentBackup = { id, environmentId, createdAt: new Date().toISOString(), configHash: await hashConfigDirectory(directories.configDir as string), path: root };
    await atomicJsonWrite(joinConfigured(root, "backup.json"), backup);
    return backup;
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

  public async restore(environmentId: string, backupId: string, confirmExternal = false): Promise<EnvironmentManifest> {
    const environment = this.requireEnvironment(environmentId);
    if (environment.directoryMode === "external" && !confirmExternal) {
      throw new EnvironmentManagerError("ENVIRONMENT_EXTERNAL_CONFIRMATION_REQUIRED", "Restoring into an external configDir requires explicit confirmation.");
    }
    const backup = (await this.backups(environmentId)).find((item) => item.id === backupId);
    if (!backup) throw new EnvironmentManagerError("ENVIRONMENT_BACKUP_NOT_FOUND", `Environment backup "${backupId}" was not found.`);
    const source = join(backup.path, "config");
    await assertDirectory(source, "backup config");
    const target = resolveEnvironmentDirectories(this.config, this.baseDirectory, environment).configDir as string;
    if (existsSync(target)) await this.backup(environmentId);
    const staging = `${target}.restore-${randomUUID()}`;
    await cp(source, staging, { recursive: true, force: false, errorOnExist: true });
    const previous = `${target}.previous-${randomUUID()}`;
    try {
      if (existsSync(target)) await rename(target, previous);
      await rename(staging, target);
      if (existsSync(previous)) await rm(previous, { recursive: true, force: true });
    } catch (error) {
      if (existsSync(staging)) await rm(staging, { recursive: true, force: true });
      if (!existsSync(target) && existsSync(previous)) await rename(previous, target);
      throw error;
    }
    return this.rescan(environmentId);
  }

  private requireEnvironment(environmentId: string): ConfigEnvironment {
    const environment = environmentCatalog(this.config).environments.find((item) => item.id === environmentId);
    if (!environment) throw new EnvironmentManagerError("ENVIRONMENT_NOT_FOUND", `Environment "${environmentId}" was not found.`);
    return environment;
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
  const relativePath = relative(sourceRoot, candidate);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return false;
  const parts = relativePath.split(/[\\/]+/u).map((part) => part.toLowerCase());
  const leaf = parts.at(-1) ?? "";
  return IGNORED_CONFIG_ROOTS.has(parts[0] ?? "") || (parts[0] === "plugins" && IGNORED_PLUGIN_ROOTS.has(parts[1] ?? "")) || /\.sqlite(?:-(?:wal|shm))?$/u.test(leaf) || leaf === "history.jsonl" || leaf === "session_index.jsonl" || leaf === "transcription-history.jsonl";
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

function isConfiguredAbsolute(path: string): boolean {
  return usesWindowsPath(path) ? win32.isAbsolute(path) : isAbsolute(path);
}

function isWithin(candidate: string, root: string): boolean {
  const pathModule = usesWindowsPath(candidate) || usesWindowsPath(root) ? win32 : { relative, isAbsolute };
  const path = pathModule.relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !pathModule.isAbsolute(path));
}

function usesWindowsPath(value: string): boolean {
  return win32.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
