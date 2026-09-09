import { createHash, randomUUID } from "node:crypto";
import { appendFile, chmod, copyFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ConfigValidationError, loadConfig, validateConfig } from "./load.js";
import type { AgentDockConfig } from "./schema.js";
import { configBaseDirectory } from "../runtime/configuration.js";
import { resolveExecutionContext, formatDryRun } from "../policy/resolver.js";
import { environmentCatalog } from "./model.js";

export interface ConfigSnapshot {
  config: AgentDockConfig;
  revision: string;
  hash: string;
}

export interface ConfigDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

export interface ConfigRiskReport {
  required: boolean;
  reasons: string[];
}

export interface ConfigDryRunRequest {
  task: string;
  agentId?: string;
  environmentId?: string;
  projectId?: string;
}

export interface ConfigPreview {
  current: ConfigSnapshot;
  candidate: AgentDockConfig;
  diff: ConfigDiffEntry[];
  highRisk: ConfigRiskReport;
  dryRun?: Record<string, unknown>;
  policyIssues: Array<{ path: string; message: string }>;
}

export interface ConfigBackup {
  id: string;
  createdAt: string;
  size: number;
}

export interface ConfigAuditEvent {
  id: string;
  timestamp: string;
  action: "config.save" | "config.restore";
  source: "web-api";
  previousRevision: string;
  revision: string;
  changedPaths: string[];
  highRiskReasons: string[];
  backupId: string;
}

export interface ConfigSaveResult extends ConfigPreview {
  backupId: string;
  auditId: string;
  restartRequired: true;
}

export class ConfigEditorError extends Error {
  public constructor(
    public readonly code: "CONFIG_CONFLICT" | "CONFIG_BACKUP_NOT_FOUND" | "CONFIG_POLICY_INVALID" | "CONFIG_CONFIRMATION_REQUIRED" | "CONFIG_AUDIT_FAILED",
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ConfigEditorError";
  }
}

export class ConfigEditor {
  private mutation: Promise<void> = Promise.resolve();

  public constructor(
    private readonly configPath: string,
    private readonly initialConfig: AgentDockConfig,
  ) {}

  public async snapshot(): Promise<ConfigSnapshot> {
    const config = await this.readCurrentConfig();
    const hash = configHash(config);
    return { config, revision: hash, hash };
  }

  public async preview(candidateInput: unknown, dryRunRequest?: ConfigDryRunRequest): Promise<ConfigPreview> {
    const current = await this.snapshot();
    const candidate = parseCandidate(candidateInput);
    const policyIssues = validatePolicyBindings(candidate, this.configPath);
    const preview: ConfigPreview = {
      current,
      candidate,
      diff: diffConfig(current.config, candidate),
      highRisk: detectHighRiskChanges(current.config, candidate),
      policyIssues,
    };
    if (dryRunRequest) {
      preview.dryRun = runDryRun(candidate, this.configPath, dryRunRequest);
    }
    return preview;
  }

  public async save(
    candidateInput: unknown,
    expectedRevision: string,
    expectedHash: string,
    confirmHighRisk: boolean,
    dryRunRequest?: ConfigDryRunRequest,
  ): Promise<ConfigSaveResult> {
    return this.withMutation(async () => {
      const preview = await this.preview(candidateInput, dryRunRequest);
      this.assertCurrentRevision(preview.current, expectedRevision, expectedHash);
      this.assertValidForSave(preview);
      if (preview.highRisk.required && !confirmHighRisk) {
        throw new ConfigEditorError("CONFIG_CONFIRMATION_REQUIRED", "High-risk configuration changes require explicit confirmation.", { highRisk: preview.highRisk });
      }
      const backupId = await this.atomicReplace(preview.candidate);
      let auditId: string;
      try {
        auditId = await this.appendAudit({
          action: "config.save",
          previousRevision: preview.current.revision,
          revision: configHash(preview.candidate),
          changedPaths: preview.diff.map((entry) => entry.path),
          highRiskReasons: preview.highRisk.reasons,
          backupId,
        });
      } catch (error) {
        await this.restoreRawBackup(backupId);
        throw new ConfigEditorError("CONFIG_AUDIT_FAILED", "The configuration was rolled back because its audit record could not be written.", { cause: String(error) });
      }
      const saved = await this.snapshot();
      return { ...preview, current: saved, backupId, auditId, restartRequired: true };
    });
  }

  public async backups(): Promise<ConfigBackup[]> {
    const directory = dirname(this.configPath);
    const prefix = `${basename(this.configPath)}.backup.`;
    let names: string[];
    try {
      names = (await readdir(directory)).filter((name) => name.startsWith(prefix));
    } catch {
      return [];
    }
    const backups = await Promise.all(names.map(async (id) => {
      try {
        const file = await stat(join(directory, id));
        return { id, createdAt: file.mtime.toISOString(), size: file.size };
      } catch {
        return undefined;
      }
    }));
    return backups.filter((backup): backup is ConfigBackup => backup !== undefined).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  public async restore(
    backupId: string,
    expectedRevision: string,
    expectedHash: string,
    confirmHighRisk: boolean,
  ): Promise<ConfigSaveResult> {
    return this.withMutation(async () => {
      const backupPath = this.resolveBackupPath(backupId);
      let backupConfig: AgentDockConfig;
      try {
        backupConfig = parseCandidate(JSON.parse(await readFile(backupPath, "utf8")) as unknown);
      } catch (error) {
        if (error instanceof ConfigValidationError) throw error;
        throw new ConfigEditorError("CONFIG_BACKUP_NOT_FOUND", `Backup "${backupId}" could not be read.`);
      }
      const preview = await this.preview(backupConfig);
      this.assertCurrentRevision(preview.current, expectedRevision, expectedHash);
      this.assertValidForSave(preview);
      if (preview.highRisk.required && !confirmHighRisk) {
        throw new ConfigEditorError("CONFIG_CONFIRMATION_REQUIRED", "Restoring this backup requires explicit high-risk confirmation.", { highRisk: preview.highRisk });
      }
      const newBackupId = await this.atomicReplace(backupConfig);
      let auditId: string;
      try {
        auditId = await this.appendAudit({
          action: "config.restore",
          previousRevision: preview.current.revision,
          revision: configHash(backupConfig),
          changedPaths: preview.diff.map((entry) => entry.path),
          highRiskReasons: preview.highRisk.reasons,
          backupId: newBackupId,
        });
      } catch (error) {
        await this.restoreRawBackup(newBackupId);
        throw new ConfigEditorError("CONFIG_AUDIT_FAILED", "The configuration was rolled back because its audit record could not be written.", { cause: String(error) });
      }
      const saved = await this.snapshot();
      return { ...preview, current: saved, backupId: newBackupId, auditId, restartRequired: true };
    });
  }

  private async readCurrentConfig(): Promise<AgentDockConfig> {
    try {
      return await loadConfig(this.configPath);
    } catch (error) {
      if (error instanceof ConfigValidationError && error.issues.length === 1 && error.issues[0]?.message === "File does not exist.") return this.initialConfig;
      throw error;
    }
  }

  private async atomicReplace(config: AgentDockConfig): Promise<string> {
    const directory = dirname(this.configPath);
    await mkdir(directory, { recursive: true });
    const backupId = `${basename(this.configPath)}.backup.${new Date().toISOString().replace(/[:.]/gu, "-")}.${randomUUID()}.json`;
    const backupPath = join(directory, backupId);
    let previousRaw: Buffer | undefined;
    try {
      previousRaw = await readFile(this.configPath);
      await copyFile(this.configPath, backupPath);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
      if (previousRaw !== undefined || code !== "ENOENT") throw error;
      await writeFile(backupPath, `${JSON.stringify(this.initialConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
    const temporaryPath = join(directory, `.${basename(this.configPath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      try {
        const currentMode = (await stat(this.configPath)).mode & 0o777;
        await chmod(temporaryPath, currentMode);
      } catch {
        await chmod(temporaryPath, 0o600);
      }
      await rename(temporaryPath, this.configPath);
      return backupId;
    } catch (error) {
      try { await unlink(temporaryPath); } catch { /* Best-effort cleanup of an incomplete write. */ }
      throw error;
    }
  }

  private async restoreRawBackup(backupId: string): Promise<void> {
    const backupPath = this.resolveBackupPath(backupId);
    const temporaryPath = `${this.configPath}.${randomUUID()}.rollback.tmp`;
    await copyFile(backupPath, temporaryPath);
    await rename(temporaryPath, this.configPath);
  }

  private resolveBackupPath(backupId: string): string {
    const expectedPrefix = `${basename(this.configPath)}.backup.`;
    if (basename(backupId) !== backupId || !backupId.startsWith(expectedPrefix)) {
      throw new ConfigEditorError("CONFIG_BACKUP_NOT_FOUND", `Backup "${backupId}" was not found.`);
    }
    return join(dirname(this.configPath), backupId);
  }

  private async appendAudit(input: Omit<ConfigAuditEvent, "id" | "timestamp" | "source">): Promise<string> {
    const id = randomUUID();
    const event: ConfigAuditEvent = { id, timestamp: new Date().toISOString(), source: "web-api", ...input };
    const auditPath = join(dirname(this.configPath), "config-audit.jsonl");
    await appendFile(auditPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    try { await chmod(auditPath, 0o600); } catch { /* Windows may not support POSIX modes. */ }
    return id;
  }

  private assertCurrentRevision(current: ConfigSnapshot, expectedRevision: string, expectedHash: string): void {
    if (expectedRevision !== current.revision || expectedHash !== current.hash) {
      throw new ConfigEditorError("CONFIG_CONFLICT", "The configuration changed since it was loaded. Reload it before saving.", {
        expectedRevision,
        expectedHash,
        currentRevision: current.revision,
        currentHash: current.hash,
      });
    }
  }

  private assertValidForSave(preview: ConfigPreview): void {
    if (preview.policyIssues.length > 0) {
      throw new ConfigEditorError("CONFIG_POLICY_INVALID", "The configuration failed Policy validation.", { issues: preview.policyIssues });
    }
    if (preview.dryRun && preview.dryRun.error) {
      throw new ConfigEditorError("CONFIG_POLICY_INVALID", "The dry-run preview failed.", { dryRun: preview.dryRun });
    }
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutation;
    let release!: () => void;
    this.mutation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export function configHash(config: AgentDockConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export function parseCandidate(input: unknown): AgentDockConfig {
  const config = validateConfig(input);
  const secretPath = findPlaintextSecretPath(config);
  if (secretPath) {
    throw new ConfigValidationError([{ path: secretPath, message: "Plaintext secrets are not accepted; use environmentPermissions[].environment.secretRefs." }]);
  }
  return config;
}

export function diffConfig(before: AgentDockConfig, after: AgentDockConfig): ConfigDiffEntry[] {
  const entries: ConfigDiffEntry[] = [];
  diffValue(before, after, "", entries);
  return entries;
}

function diffValue(before: unknown, after: unknown, path: string, entries: ConfigDiffEntry[]): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) diffValue(before[key], after[key], path ? `${path}.${key}` : key, entries);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) diffValue(before[index], after[index], `${path}[${index}]`, entries);
    return;
  }
  entries.push({ path: path || "<root>", before, after });
}

export function detectHighRiskChanges(before: AgentDockConfig, after: AgentDockConfig): ConfigRiskReport {
  const reasons: string[] = [];
  const beforeCatalog = environmentCatalog(before);
  const afterCatalog = environmentCatalog(after);
  const beforeEngines = new Map(beforeCatalog.engines.map((engine) => [engine.id, engine]));
  for (const engine of afterCatalog.engines) {
    const previous = beforeEngines.get(engine.id);
    if (!previous || JSON.stringify({ adapter: engine.adapter, binary: engine.binary, args: engine.args }) !== JSON.stringify({ adapter: previous.adapter, binary: previous.binary, args: previous.args })) {
      reasons.push(`Engine "${engine.id}" changes its executable or arguments.`);
    }
  }
  const beforePermissions = new Map(beforeCatalog.permissions.map((permission) => [permission.id, permission]));
  for (const permission of afterCatalog.permissions) {
    const previous = beforePermissions.get(permission.id);
    if (permission.filesystem.write && !previous?.filesystem.write) reasons.push(`Environment Permission "${permission.id}" enables filesystem write access.`);
    if (permission.network === "allow" && previous?.network !== "allow") reasons.push(`Environment Permission "${permission.id}" enables network access.`);
    if (JSON.stringify(previous?.filesystem.roots) !== JSON.stringify(permission.filesystem.roots)) reasons.push(`Environment Permission "${permission.id}" changes filesystem roots.`);
    const previousRefs = previous?.environment.secretRefs ?? {};
    for (const key of Object.keys(permission.environment.secretRefs ?? {}).sort()) {
      if (JSON.stringify(previousRefs[key]) !== JSON.stringify(permission.environment.secretRefs?.[key])) reasons.push(`Environment Permission "${permission.id}" changes Secret Reference "${key}".`);
    }
  }
  const beforeEnvironments = new Map(beforeCatalog.environments.map((environment) => [environment.id, environment]));
  for (const environment of afterCatalog.environments) {
    const previous = beforeEnvironments.get(environment.id);
    if (!previous || environment.directoryMode !== previous.directoryMode || environment.homeDir !== previous.homeDir || environment.configDir !== previous.configDir || environment.stateDir !== previous.stateDir || environment.cacheDir !== previous.cacheDir) {
      reasons.push(`Environment "${environment.id}" changes native directory ownership or paths.`);
    }
    if (JSON.stringify(environment.launchArgs) !== JSON.stringify(previous?.launchArgs)) reasons.push(`Environment "${environment.id}" changes launch arguments.`);
    for (const key of findRiskySettingKeys(environment.settings, previous?.settings)) reasons.push(`Environment "${environment.id}" changes shell or command setting "${key}".`);
  }
  return { required: reasons.length > 0, reasons: [...new Set(reasons)] };
}

function findRiskySettingKeys(after: Record<string, unknown>, before: Record<string, unknown> | undefined): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const risky = normalized.includes("shell") || normalized.includes("command") || normalized === "exec" || normalized.includes("executable");
    if (risky && JSON.stringify(value) !== JSON.stringify(before?.[key])) keys.push(key);
  }
  return keys;
}

function validatePolicyBindings(config: AgentDockConfig, configPath: string): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  const enabledConfig: AgentDockConfig = {
    ...config,
    engines: config.engines.map((engine) => ({ ...engine, enabled: true })),
  };
  for (const [index, project] of config.projects.entries()) {
    const ids = project.agentIds;
    for (const [agentIndex, agentId] of ids.entries()) {
      try {
        resolveExecutionContext({ config: enabledConfig, baseDirectory: configBaseDirectory(configPath), agentId, projectId: project.id });
      } catch (error) {
        issues.push({ path: `projects.${index}.agentIds.${agentIndex}`, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return issues;
}

function runDryRun(config: AgentDockConfig, configPath: string, request: ConfigDryRunRequest): Record<string, unknown> {
  try {
    const context = resolveExecutionContext({
      config,
      baseDirectory: configBaseDirectory(configPath),
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.environmentId ? { environmentId: request.environmentId } : {}),
      ...(request.projectId ? { projectId: request.projectId } : {}),
    });
    return formatDryRun(context, request.task);
  } catch (error) {
    return { executes: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findPlaintextSecretPath(value: unknown, path = "", insideSecretReference = false): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = findPlaintextSecretPath(item, `${path}[${index}]`, insideSecretReference);
      if (result) return result;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const nextPath = path ? `${path}.${key}` : key;
    const looksLikePlaintextSecret = normalized.includes("apikey") || normalized.includes("authorization") || normalized.includes("credential") || normalized.includes("password") || normalized.includes("secret") || normalized.includes("token");
    if (!insideSecretReference && normalized !== "secretrefs" && looksLikePlaintextSecret) return nextPath;
    const result = findPlaintextSecretPath(item, nextPath, insideSecretReference || normalized === "secretrefs");
    if (result) return result;
  }
  return undefined;
}
