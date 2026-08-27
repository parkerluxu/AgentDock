import { randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isCapabilitySupported,
  validateAdapterManifest,
  type AdapterManifest,
  type AdapterPermission,
  type AgentAdapter,
} from "../adapter-contract/index.js";
import type { RuntimeDescriptor } from "../core/types.js";
import type { AgentDockConfig } from "../config/schema.js";
import { configDataPath } from "./configuration.js";
import type { RuntimeRegistry } from "./registry.js";

const LOCAL_ADAPTER_STATE_VERSION = 1;
const MANIFEST_FILENAMES = ["agentdock-adapter.json", "manifest.json"] as const;

export interface LocalAdapterRecord {
  manifest: AdapterManifest;
  enabled: boolean;
  grantedPermissions: AdapterPermission[];
  installedAt: string;
}

interface LocalAdapterState {
  version: typeof LOCAL_ADAPTER_STATE_VERSION;
  adapters: LocalAdapterRecord[];
}

export class LocalAdapterStore {
  private readonly directory: string;
  private readonly statePath: string;

  public constructor(directory: string) {
    this.directory = resolve(directory);
    this.statePath = join(this.directory, "registry.json");
  }

  public list(): LocalAdapterRecord[] {
    return this.readState().adapters.map(cloneRecord);
  }

  public get(name: string): LocalAdapterRecord | undefined {
    return this.list().find((adapter) => adapter.manifest.name === name);
  }

  public install(sourcePath: string): LocalAdapterRecord {
    const source = resolve(sourcePath);
    const { sourceDirectory, manifestPath } = resolveManifestPath(source);
    const manifest = validateAdapterManifest(readJson(manifestPath));
    assertLocalAdapterName(manifest.name);
    if (manifest.entry.startsWith("builtin:")) {
      throw new Error("A local Adapter manifest entry must point to a file in the package directory.");
    }

    const sourceRoot = realDirectory(sourceDirectory);
    realFileInside(sourceRoot, manifest.entry, "manifest.entry");
    const existing = this.readState().adapters.find((adapter) => adapter.manifest.name === manifest.name);
    if (existing) throw new Error(`Local Adapter "${manifest.name}" is already installed.`);

    mkdirSync(this.directory, { recursive: true });
    const target = join(this.directory, manifest.name);
    if (existsSync(target)) throw new Error(`The local Adapter directory for "${manifest.name}" already exists.`);

    const temporaryTarget = join(this.directory, `.install-${randomUUID()}`);
    try {
      cpSync(sourceRoot, temporaryTarget, { recursive: true, force: false, errorOnExist: true });
      const installedEntry = realFileInside(temporaryTarget, manifest.entry, "manifest.entry");
      if (installedEntry !== resolve(temporaryTarget, manifest.entry)) {
        throw new Error("The installed Adapter entry does not resolve inside the package directory.");
      }
      renameSync(temporaryTarget, target);
    } catch (error) {
      if (existsSync(temporaryTarget)) rmSync(temporaryTarget, { recursive: true, force: true });
      throw error;
    }

    const record: LocalAdapterRecord = {
      manifest: cloneManifest(manifest),
      enabled: false,
      grantedPermissions: [],
      installedAt: new Date().toISOString(),
    };
    try {
      this.writeState({ version: LOCAL_ADAPTER_STATE_VERSION, adapters: [...this.readState().adapters, record] });
    } catch (error) {
      rmSync(target, { recursive: true, force: true });
      throw error;
    }
    return cloneRecord(record);
  }

  public enable(name: string, permissions: AdapterPermission[] = []): LocalAdapterRecord {
    const state = this.readState();
    const index = state.adapters.findIndex((adapter) => adapter.manifest.name === name);
    if (index < 0) throw new Error(`Local Adapter "${name}" is not installed.`);
    const record = state.adapters[index] as LocalAdapterRecord;
    const invalidPermissions = permissions.filter((permission) => !record.manifest.requiredPermissions.includes(permission));
    if (invalidPermissions.length > 0) {
      throw new Error(`Adapter "${name}" does not request permission(s): ${invalidPermissions.join(", ")}.`);
    }
    const grantedPermissions = [...new Set([...record.grantedPermissions, ...permissions])];
    const missingPermissions = record.manifest.requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
    if (missingPermissions.length > 0) {
      throw new Error(`Adapter "${name}" requires explicit permission grant(s): ${missingPermissions.join(", ")}.`);
    }
    state.adapters[index] = { ...record, enabled: true, grantedPermissions };
    this.writeState(state);
    return cloneRecord(state.adapters[index]);
  }

  public disable(name: string): LocalAdapterRecord {
    return this.updateEnabled(name, false);
  }

  public uninstall(name: string): void {
    const state = this.readState();
    const index = state.adapters.findIndex((adapter) => adapter.manifest.name === name);
    if (index < 0) throw new Error(`Local Adapter "${name}" is not installed.`);
    const record = state.adapters[index] as LocalAdapterRecord;
    if (record.enabled) throw new Error(`Disable local Adapter "${name}" before uninstalling it.`);
    const target = this.packageDirectory(name);
    assertChildPath(this.directory, target);
    if (existsSync(target)) rmSync(target, { recursive: true, force: false });
    state.adapters.splice(index, 1);
    this.writeState(state);
  }

  public packageDirectory(name: string): string {
    const record = this.get(name);
    if (!record) throw new Error(`Local Adapter "${name}" is not installed.`);
    return join(this.directory, record.manifest.name);
  }

  public entryPath(record: LocalAdapterRecord): string {
    const packageDirectory = this.packageDirectory(record.manifest.name);
    return realFileInside(packageDirectory, record.manifest.entry, "manifest.entry");
  }

  private updateEnabled(name: string, enabled: boolean): LocalAdapterRecord {
    const state = this.readState();
    const index = state.adapters.findIndex((adapter) => adapter.manifest.name === name);
    if (index < 0) throw new Error(`Local Adapter "${name}" is not installed.`);
    const record = state.adapters[index] as LocalAdapterRecord;
    state.adapters[index] = { ...record, enabled };
    this.writeState(state);
    return cloneRecord(state.adapters[index]);
  }

  private readState(): LocalAdapterState {
    if (!existsSync(this.statePath)) return { version: LOCAL_ADAPTER_STATE_VERSION, adapters: [] };
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(this.statePath, "utf8")) as unknown;
    } catch (error) {
      throw new Error(`Could not read local Adapter registry: ${String(error)}`);
    }
    if (!isRecord(input) || input.version !== LOCAL_ADAPTER_STATE_VERSION || !Array.isArray(input.adapters)) {
      throw new Error("The local Adapter registry is invalid.");
    }
    const adapters = input.adapters.map((item, index) => parseRecord(item, index));
    const names = new Set<string>();
    for (const adapter of adapters) {
      if (names.has(adapter.manifest.name)) throw new Error(`The local Adapter registry contains duplicate "${adapter.manifest.name}" entries.`);
      names.add(adapter.manifest.name);
    }
    return { version: LOCAL_ADAPTER_STATE_VERSION, adapters };
  }

  private writeState(state: LocalAdapterState): void {
    mkdirSync(this.directory, { recursive: true });
    const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8" });
    try {
      renameSync(temporaryPath, this.statePath);
    } catch (error) {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}

export function localAdapterDirectory(config: AgentDockConfig, configPath: string): string {
  return join(dirname(configDataPath(config, configPath)), "adapters");
}

export async function registerEnabledLocalAdapters(store: LocalAdapterStore, registry: RuntimeRegistry): Promise<void> {
  for (const record of store.list().filter((adapter) => adapter.enabled)) {
    const missingPermissions = record.manifest.requiredPermissions.filter((permission) => !record.grantedPermissions.includes(permission));
    if (missingPermissions.length > 0) {
      throw new Error(`Adapter "${record.manifest.name}" is enabled without explicit permission grant(s): ${missingPermissions.join(", ")}.`);
    }
    if (registry.list().includes(record.manifest.name)) {
      throw new Error(`Local Adapter "${record.manifest.name}" cannot override a built-in or registered Adapter.`);
    }
    const entryPath = store.entryPath(record);
    const module = await import(`${pathToFileURL(entryPath).href}?agentdock=${encodeURIComponent(record.installedAt)}`) as Record<string, unknown>;
    const factory = resolveAdapterFactory(module, record.manifest.name);
    registry.register(record.manifest.name, (runtime) => {
      const adapter = factory(runtime);
      validateLoadedAdapter(adapter, record.manifest, runtime);
      return adapter;
    });
  }
}

type AdapterFactory = (runtime: RuntimeDescriptor) => AgentAdapter;
type AdapterExport = ((runtime: RuntimeDescriptor) => unknown) | (new (runtime: RuntimeDescriptor) => unknown);

function resolveAdapterFactory(module: Record<string, unknown>, adapterName: string): AdapterFactory {
  const namedExport = `${toPascalCase(adapterName)}Adapter`;
  const candidates = [module.createAdapter, module.default, module.Adapter, module[namedExport]];
  const candidate = candidates.find((value): value is AdapterExport => typeof value === "function");
  if (!candidate) {
    throw new Error(`Local Adapter "${adapterName}" must export createAdapter(), a default Adapter, Adapter, or ${namedExport}.`);
  }
  return (runtime) => {
    const value = isClass(candidate)
      ? new (candidate as new (runtime: RuntimeDescriptor) => unknown)(runtime)
      : (candidate as (runtime: RuntimeDescriptor) => unknown)(runtime);
    if (!isRecord(value)) throw new Error(`Local Adapter "${adapterName}" did not create an Adapter object.`);
    return value as unknown as AgentAdapter;
  };
}

function validateLoadedAdapter(adapter: AgentAdapter, installedManifest: AdapterManifest, runtime: RuntimeDescriptor): void {
  validateAdapterManifest(adapter.manifest);
  if (typeof adapter.healthCheck !== "function" || typeof adapter.execute !== "function" || typeof adapter.cancel !== "function") {
    throw new Error(`Local Adapter "${installedManifest.name}" does not implement healthCheck(), execute() and cancel().`);
  }
  if (isCapabilitySupported(installedManifest, "create_session") && typeof adapter.createSession !== "function") {
    throw new Error(`Local Adapter "${installedManifest.name}" declares create_session but does not implement createSession().`);
  }
  if (isCapabilitySupported(installedManifest, "resume_session") && typeof adapter.resumeSession !== "function") {
    throw new Error(`Local Adapter "${installedManifest.name}" declares resume_session but does not implement resumeSession().`);
  }
  if (!sameManifest(adapter.manifest, installedManifest)) {
    throw new Error(`Loaded Adapter manifest does not match installed manifest for "${installedManifest.name}".`);
  }
  if (adapter.manifest.runtime.id !== installedManifest.runtime.id || runtime.id !== installedManifest.runtime.id) {
    throw new Error(`Adapter "${installedManifest.name}" is incompatible with Runtime "${runtime.id}".`);
  }
}

function resolveManifestPath(source: string): { sourceDirectory: string; manifestPath: string } {
  const sourceStat = statSync(source);
  if (sourceStat.isFile()) return { sourceDirectory: dirname(source), manifestPath: source };
  if (!sourceStat.isDirectory()) throw new Error(`Adapter source "${source}" must be a file or directory.`);
  for (const filename of MANIFEST_FILENAMES) {
    const manifestPath = join(source, filename);
    if (existsSync(manifestPath) && statSync(manifestPath).isFile()) return { sourceDirectory: source, manifestPath };
  }
  throw new Error(`No local Adapter manifest found in "${source}". Expected ${MANIFEST_FILENAMES.join(" or ")}.`);
}

function realDirectory(directory: string): string {
  const resolved = resolve(directory);
  if (!lstatSync(resolved).isDirectory()) throw new Error(`Adapter package root "${resolved}" is not a directory.`);
  return resolved;
}

function realFileInside(root: string, entry: string, label: string): string {
  if (isAbsolute(entry)) throw new Error(`${label} must be a relative path inside the package directory.`);
  const lexicalPath = resolve(root, entry);
  assertChildPath(root, lexicalPath);
  if (!existsSync(lexicalPath) || !lstatSync(lexicalPath).isFile()) throw new Error(`${label} must point to an existing file.`);
  const realRoot = resolve(root);
  const realEntry = resolvePathWithSymlinks(lexicalPath);
  assertChildPath(realRoot, realEntry);
  return realEntry;
}

function resolvePathWithSymlinks(path: string): string {
  return realpathSync(path);
}

function assertChildPath(root: string, candidate: string): void {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const relativePath = relative(rootPath, candidatePath);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Path "${candidatePath}" must be inside "${rootPath}".`);
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Could not read Adapter manifest "${path}": ${String(error)}`);
  }
}

function parseRecord(input: unknown, index: number): LocalAdapterRecord {
  if (!isRecord(input) || !isRecord(input.manifest) || typeof input.enabled !== "boolean" || !Array.isArray(input.grantedPermissions) || typeof input.installedAt !== "string") {
    throw new Error(`The local Adapter registry entry at index ${index} is invalid.`);
  }
  const manifest = validateAdapterManifest(input.manifest);
  assertLocalAdapterName(manifest.name);
  const grantedPermissions = input.grantedPermissions.filter((permission): permission is AdapterPermission => typeof permission === "string")
    .filter((permission, permissionIndex, permissions) => permissions.indexOf(permission) === permissionIndex);
  if (grantedPermissions.some((permission) => !manifest.requiredPermissions.includes(permission))) {
    throw new Error(`The local Adapter registry entry for "${manifest.name}" contains an unrequested permission.`);
  }
  return { manifest, enabled: input.enabled, grantedPermissions, installedAt: input.installedAt };
}

function cloneRecord(record: LocalAdapterRecord): LocalAdapterRecord {
  return { ...record, manifest: cloneManifest(record.manifest), grantedPermissions: [...record.grantedPermissions] };
}

function cloneManifest(manifest: AdapterManifest): AdapterManifest {
  return {
    ...manifest,
    runtime: { ...manifest.runtime },
    capabilities: [...manifest.capabilities],
    requiredPermissions: [...manifest.requiredPermissions],
  };
}

function isClass(value: AdapterExport): boolean {
  return /^class\s/.test(Function.prototype.toString.call(value));
}

function toPascalCase(value: string): string {
  return value.split(/[-_.]/u).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertLocalAdapterName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name)) {
    throw new Error(`Local Adapter name "${name}" must be a lowercase identifier.`);
  }
}

function sameManifest(left: AdapterManifest, right: AdapterManifest): boolean {
  return left.name === right.name
    && left.version === right.version
    && left.entry === right.entry
    && left.agentDockApi === right.agentDockApi
    && left.runtime.id === right.runtime.id
    && left.runtime.versionRange === right.runtime.versionRange
    && sameValues(left.capabilities, right.capabilities)
    && sameValues(left.requiredPermissions, right.requiredPermissions);
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
