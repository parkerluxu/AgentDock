import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AgentDockConfig } from "../config/schema.js";
import { AgentDockError } from "../core/errors.js";
import { configDataPath } from "../runtime/configuration.js";

/** The DSH plugin's shipped profile points at this local-only port. */
export const DEFAULT_DSH_API_PORT = 4177;
const TOKEN_MINIMUM_LENGTH = 16;
const HEALTH_TIMEOUT_MS = 1_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const OWNERSHIP_FILE = "dsh-api-ownership.json";
const START_LOCK_DIRECTORY = "dsh-start.lock";

type SpawnChild = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
type FetchImplementation = typeof globalThis.fetch;

export class DshLauncherError extends AgentDockError {
  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "DshLauncherError";
  }
}

export interface ApiOwnershipRecord {
  ownershipVersion: 1;
  pid: number;
  startedAt: string;
  configPath: string;
  configHash: string;
  port: number;
}

export interface ManagedApiLeaseInfo {
  apiBaseUrl: string;
  ownership: "owned" | "reused";
}

export interface DshProcessResult {
  exitCode: number | null;
  signal?: NodeJS.Signals;
}

export interface DshProcessLaunchOptions {
  command: string;
  profile?: string;
  signal?: AbortSignal;
  /** Kept internal to the launcher; never serialize or log this value. */
  token: string;
}

export interface DshProcessLauncherOptions {
  spawn?: SpawnChild;
  writeStdout?: (data: string) => void;
  writeStderr?: (data: string) => void;
}

/**
 * Starts DSH with a copied environment. Its API token exists only in that
 * child's environment and is redacted before any child output is forwarded.
 */
export class DshProcessLauncher {
  private readonly spawnChild: SpawnChild;
  private readonly writeStdout: (data: string) => void;
  private readonly writeStderr: (data: string) => void;

  public constructor(options: DshProcessLauncherOptions = {}) {
    this.spawnChild = options.spawn ?? spawn;
    this.writeStdout = options.writeStdout ?? ((data) => process.stdout.write(data));
    this.writeStderr = options.writeStderr ?? ((data) => process.stderr.write(data));
  }

  public async launch(options: DshProcessLaunchOptions): Promise<DshProcessResult> {
    const command = options.command.trim();
    if (!command) throw new DshLauncherError("DSH_COMMAND_REQUIRED", "dsh start requires an explicit --dsh-command until a compatible DSH CLI is detected.");
    const args = options.profile?.trim() ? ["--profile", options.profile.trim()] : [];
    const environment = { ...process.env, AGENTDOCK_API_TOKEN: options.token };
    let child: ChildProcess;
    try {
      child = this.spawnChild(command, args, {
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ["inherit", "pipe", "pipe"],
      });
    } catch (error) {
      throw new DshLauncherError("DSH_START_FAILED", "The DSH process could not be started.", { cause: error });
    }
    const stdoutRedactor = new SecretStreamRedactor(options.token, this.writeStdout);
    const stderrRedactor = new SecretStreamRedactor(options.token, this.writeStderr);
    child.stdout?.on("data", (data: Buffer | string) => stdoutRedactor.write(String(data)));
    child.stderr?.on("data", (data: Buffer | string) => stderrRedactor.write(String(data)));
    return new Promise<DshProcessResult>((resolveResult, reject) => {
      const cancel = (): void => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      };
      const cleanup = (): void => options.signal?.removeEventListener("abort", cancel);
      if (options.signal?.aborted) cancel();
      else options.signal?.addEventListener("abort", cancel, { once: true });
      child.once("error", (error) => {
        cleanup();
        stdoutRedactor.finish();
        stderrRedactor.finish();
        reject(new DshLauncherError("DSH_START_FAILED", "The DSH process could not be started.", { cause: error }));
      });
      child.once("exit", (exitCode, signal) => {
        cleanup();
        stdoutRedactor.finish();
        stderrRedactor.finish();
        resolveResult({ exitCode, ...(signal ? { signal: signal as NodeJS.Signals } : {}) });
      });
    });
  }
}

export interface LoopbackApiSupervisorOptions {
  config: AgentDockConfig;
  configPath: string;
  port?: number;
  /** Node executable plus the AgentDock CLI entrypoint used for an owned API. */
  apiCommand: { command: string; args: string[] };
  fetch?: FetchImplementation;
  spawn?: SpawnChild;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  startupTimeoutMs?: number;
}

interface OwnedApiProcess {
  child: ChildProcess;
  record: ApiOwnershipRecord;
}

/**
 * Reads only the local file managed by AgentDock's API token lifecycle. It
 * deliberately does not accept an environment token or a token option.
 */
export class ManagedTokenReader {
  public constructor(private readonly tokenPath: string) {}

  public async read(): Promise<string> {
    let token: string;
    try {
      token = (await readFile(this.tokenPath, "utf8")).trim();
    } catch (error) {
      throw new DshLauncherError("MANAGED_TOKEN_UNAVAILABLE", "A loopback AgentDock API is running, but its managed token is unavailable. Restart it through dsh start instead of supplying a token manually.", { cause: error });
    }
    if (token.length < TOKEN_MINIMUM_LENGTH) {
      throw new DshLauncherError("MANAGED_TOKEN_UNAVAILABLE", "A loopback AgentDock API is running, but its managed token is unavailable. Restart it through dsh start instead of supplying a token manually.");
    }
    return token;
  }
}

/**
 * An acquired API connection. The token is held in a private field and can
 * only be supplied to the dedicated DSH child launcher.
 */
export class ManagedApiLease implements ManagedApiLeaseInfo {
  public readonly apiBaseUrl: string;
  public readonly ownership: "owned" | "reused";
  readonly #token: string;
  private readonly release: () => Promise<void>;
  private stopped = false;

  public constructor(input: ManagedApiLeaseInfo & { token: string; release: () => Promise<void> }) {
    this.apiBaseUrl = input.apiBaseUrl;
    this.ownership = input.ownership;
    this.#token = input.token;
    this.release = input.release;
  }

  public launchDsh(launcher: DshProcessLauncher, input: Omit<DshProcessLaunchOptions, "token">): Promise<DshProcessResult> {
    return launcher.launch({ ...input, token: this.#token });
  }

  public async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.release();
  }
}

/**
 * Reuses an authenticated loopback API when possible, otherwise starts an
 * owned AgentDock API and records only non-sensitive ownership metadata.
 */
export class LoopbackApiSupervisor {
  private readonly config: AgentDockConfig;
  private readonly configPath: string;
  private readonly port: number;
  private readonly apiCommand: { command: string; args: string[] };
  private readonly fetchImplementation: FetchImplementation;
  private readonly spawnChild: SpawnChild;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly startupTimeoutMs: number;
  private readonly controlDirectory: string;
  private readonly tokenReader: ManagedTokenReader;
  private readonly ownershipPath: string;
  private readonly startLockPath: string;
  private owned: OwnedApiProcess | undefined;

  public constructor(options: LoopbackApiSupervisorOptions) {
    this.config = options.config;
    this.configPath = resolve(options.configPath);
    this.port = options.port ?? DEFAULT_DSH_API_PORT;
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65_535) {
      throw new DshLauncherError("INVALID_LOOPBACK_PORT", "dsh start requires a loopback port between 1 and 65535.");
    }
    this.apiCommand = options.apiCommand;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.spawnChild = options.spawn ?? spawn;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
    this.now = options.now ?? (() => new Date());
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.controlDirectory = dirname(configDataPath(this.config, this.configPath));
    this.tokenReader = new ManagedTokenReader(join(this.controlDirectory, "api-token"));
    this.ownershipPath = join(this.controlDirectory, OWNERSHIP_FILE);
    this.startLockPath = join(this.controlDirectory, START_LOCK_DIRECTORY);
  }

  public async start(): Promise<ManagedApiLease> {
    const reusable = await this.readReusableToken();
    if (reusable) return this.lease("reused", reusable, async () => undefined);
    await mkdir(this.controlDirectory, { recursive: true });
    await this.acquireStartLock();
    try {
      // Another launcher may have completed while this process was waiting for
      // the lock. Reuse its authenticated API rather than starting another.
      const afterLock = await this.readReusableToken();
      if (afterLock) return this.lease("reused", afterLock, async () => undefined);
      return await this.startOwned();
    } finally {
      await this.releaseStartLock();
    }
  }

  private async startOwned(): Promise<ManagedApiLease> {
    const child = this.startOwnedApi();
    const record: ApiOwnershipRecord = {
      ownershipVersion: 1,
      pid: child.pid ?? 0,
      startedAt: this.now().toISOString(),
      configPath: this.configPath,
      configHash: fingerprintConfig(this.config),
      port: this.port,
    };
    if (!child.pid) {
      void terminateChild(child);
      throw new DshLauncherError("MANAGED_API_START_FAILED", "The managed AgentDock API did not provide a process identifier.");
    }
    try {
      const token = await this.waitUntilReady(child);
      await writeFile(this.ownershipPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      this.owned = { child, record };
      return this.lease("owned", token, async () => this.stopOwned(record));
    } catch (error) {
      await terminateChild(child);
      await rm(this.ownershipPath, { force: true });
      if (error instanceof DshLauncherError) throw error;
      throw new DshLauncherError("MANAGED_API_START_FAILED", "The managed AgentDock API did not become ready.", { cause: error });
    }
  }

  private async acquireStartLock(): Promise<void> {
    let clearedStaleLock = false;
    while (true) {
      try {
        await mkdir(this.startLockPath);
        await writeFile(join(this.startLockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: this.now().toISOString(), configPath: this.configPath })}\n`, { encoding: "utf8", mode: 0o600 });
        return;
      } catch (error) {
        const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
        if (code !== "EEXIST" || clearedStaleLock || !await this.clearStaleStartLock()) {
          throw new DshLauncherError("DSH_START_IN_PROGRESS", "Another dsh start process is already managing this AgentDock configuration.", { cause: error });
        }
        clearedStaleLock = true;
      }
    }
  }

  private async clearStaleStartLock(): Promise<boolean> {
    let owner: { pid?: unknown } | undefined;
    try {
      owner = JSON.parse(await readFile(join(this.startLockPath, "owner.json"), "utf8")) as { pid?: unknown };
    } catch {
      // A partially written lock is stale because mkdir is atomic and no owner
      // record could be completed.
    }
    if (typeof owner?.pid === "number" && processExists(owner.pid)) return false;
    await rm(this.startLockPath, { recursive: true, force: true });
    return true;
  }

  private async releaseStartLock(): Promise<void> {
    await rm(this.startLockPath, { recursive: true, force: true });
  }

  private lease(ownership: "owned" | "reused", token: string, release: () => Promise<void>): ManagedApiLease {
    return new ManagedApiLease({ apiBaseUrl: this.apiBaseUrl(), ownership, token, release });
  }

  private startOwnedApi(): ChildProcess {
    const environment = { ...process.env };
    delete environment.AGENTDOCK_API_TOKEN;
    try {
      return this.spawnChild(this.apiCommand.command, [
        ...this.apiCommand.args,
        "api",
        "serve",
        "--config",
        this.configPath,
        "--port",
        String(this.port),
      ], {
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw new DshLauncherError("MANAGED_API_START_FAILED", "The managed AgentDock API could not be started.", { cause: error });
    }
  }

  private async waitUntilReady(child: ChildProcess): Promise<string> {
    const deadline = Date.now() + this.startupTimeoutMs;
    let delay = 25;
    let childFailure: Error | undefined;
    child.once("error", () => { childFailure = new DshLauncherError("MANAGED_API_START_FAILED", "The managed AgentDock API could not be started."); });
    child.once("exit", () => { childFailure = new DshLauncherError("MANAGED_API_START_FAILED", "The managed AgentDock API exited before it became ready."); });
    while (Date.now() <= deadline) {
      if (childFailure) throw childFailure;
      const token = await this.readReusableToken();
      if (token) return token;
      await this.sleep(delay);
      delay = Math.min(delay * 2, 500);
    }
    throw new DshLauncherError("MANAGED_API_START_TIMEOUT", "The managed AgentDock API did not become ready before the startup timeout.");
  }

  private async readReusableToken(): Promise<string | undefined> {
    const response = await this.health();
    if (!response) return undefined;
    if (response.status !== 200 && response.status !== 401) {
      throw new DshLauncherError("LOOPBACK_PORT_UNAVAILABLE", "The requested loopback port is occupied by a service that is not an AgentDock API.");
    }
    const token = await this.tokenReader.read();
    const authenticated = await this.health(token);
    if (!authenticated || authenticated.status !== 200) {
      throw new DshLauncherError("MANAGED_TOKEN_INVALID", "The running loopback AgentDock API cannot be authenticated with its managed token. Restart it through dsh start instead of supplying a token manually.");
    }
    return token;
  }

  private async health(token?: string): Promise<Response | undefined> {
    try {
      const options: RequestInit = { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) };
      if (token) options.headers = { authorization: `Bearer ${token}` };
      return await this.fetchImplementation(`${this.apiBaseUrl()}/health`, options);
    } catch {
      return undefined;
    }
  }

  private apiBaseUrl(): string {
    return `http://127.0.0.1:${this.port}/api/v1`;
  }

  private async stopOwned(expected: ApiOwnershipRecord): Promise<void> {
    const owned = this.owned;
    if (!owned || !sameOwnership(owned.record, expected)) return;
    const persisted = await readOwnership(this.ownershipPath);
    if (!persisted || !sameOwnership(persisted, expected) || owned.child.pid !== expected.pid) return;
    await terminateChild(owned.child);
    await rm(this.ownershipPath, { force: true });
    this.owned = undefined;
  }
}

async function readOwnership(path: string): Promise<ApiOwnershipRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<ApiOwnershipRecord>;
    if (value.ownershipVersion !== 1 || typeof value.pid !== "number" || typeof value.startedAt !== "string" || typeof value.configPath !== "string" || typeof value.configHash !== "string" || typeof value.port !== "number") return undefined;
    return value as ApiOwnershipRecord;
  } catch {
    return undefined;
  }
}

function sameOwnership(left: ApiOwnershipRecord, right: ApiOwnershipRecord): boolean {
  return left.pid === right.pid
    && left.startedAt === right.startedAt
    && left.configPath === right.configPath
    && left.configHash === right.configHash
    && left.port === right.port;
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.killed) return;
  const stopped = new Promise<void>((resolveStop) => child.once("exit", () => resolveStop()));
  child.kill("SIGTERM");
  await Promise.race([stopped, new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 2_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function fingerprintConfig(config: AgentDockConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Retains a possible token prefix between stream chunks before forwarding it. */
class SecretStreamRedactor {
  private tail = "";

  public constructor(private readonly secret: string, private readonly forward: (data: string) => void) {}

  public write(data: string): void {
    const combined = this.tail + data;
    const lastCompleteSecret = combined.lastIndexOf(this.secret);
    const possiblePrefix = lastCompleteSecret < 0 ? combined : combined.slice(lastCompleteSecret + this.secret.length);
    const tailLength = matchingPrefixSuffixLength(possiblePrefix, this.secret);
    const ready = combined.slice(0, combined.length - tailLength).split(this.secret).join("[REDACTED]");
    if (ready) this.forward(ready);
    this.tail = combined.slice(combined.length - tailLength);
  }

  public finish(): void {
    // A dangling token prefix is not useful output and should not expose even a
    // partial credential when a child crashes mid-write.
    if (this.tail) this.forward("[REDACTED]");
    this.tail = "";
  }
}

function matchingPrefixSuffixLength(value: string, secret: string): number {
  const maximum = Math.min(secret.length - 1, value.length);
  for (let length = maximum; length > 0; length -= 1) {
    if (value.endsWith(secret.slice(0, length))) return length;
  }
  return 0;
}
