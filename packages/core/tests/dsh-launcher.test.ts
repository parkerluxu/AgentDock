import { type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateConfig } from "../src/config/load.js";
import { DshLauncherError, DshProcessLauncher, LoopbackApiSupervisor } from "../src/dsh-launcher/launcher.js";

const parentToken = "parent-token-that-must-not-reach-managed-api";
const managedToken = "managed-token-for-dsh-launcher-tests";
const originalApiToken = process.env.AGENTDOCK_API_TOKEN;
const directories: string[] = [];

afterEach(() => {
  if (originalApiToken === undefined) delete process.env.AGENTDOCK_API_TOKEN;
  else process.env.AGENTDOCK_API_TOKEN = originalApiToken;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("DSH launcher", () => {
  it("reuses only a loopback API that accepts its managed token", async () => {
    const directory = fixtureDirectory();
    writeManagedToken(directory, managedToken);
    const server = await healthServer(managedToken);
    try {
      const port = Number((server.address() as { port: number }).port);
      const supervisor = new LoopbackApiSupervisor({
        config: fixtureConfig(),
        configPath: join(directory, "config.json"),
        port,
        apiCommand: { command: process.execPath, args: [] },
        spawn: (() => { throw new Error("a healthy API must be reused"); }) as never,
      });
      const lease = await supervisor.start();
      expect(lease).toMatchObject({ ownership: "reused", apiBaseUrl: `http://127.0.0.1:${port}/api/v1` });
      expect(JSON.stringify(lease)).not.toContain(managedToken);
      await lease.stop();
      expect(server.listening).toBe(true);
    } finally {
      await close(server);
    }
  });

  it("starts an owned API without inheriting a caller token and removes its token-free ownership record", async () => {
    const directory = fixtureDirectory();
    writeManagedToken(directory, managedToken);
    process.env.AGENTDOCK_API_TOKEN = parentToken;
    let apiStarted = false;
    const child = new FakeChild(9001);
    const spawn = vi.fn(() => {
      apiStarted = true;
      return child as unknown as ChildProcess;
    });
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!apiStarted) throw new TypeError("connection refused");
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === `Bearer ${managedToken}`) return new Response(JSON.stringify({ healthy: true }), { status: 200 });
      return new Response("authentication required", { status: 401 });
    });
    const supervisor = new LoopbackApiSupervisor({
      config: fixtureConfig(),
      configPath: join(directory, "config.json"),
      port: 4177,
      apiCommand: { command: process.execPath, args: ["fake-agentdock-cli.js"] },
      spawn: spawn as never,
      fetch,
      sleep: async () => undefined,
      startupTimeoutMs: 100,
    });

    const lease = await supervisor.start();
    const [command, args, options] = spawn.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(["fake-agentdock-cli.js", "api", "serve", "--config", join(directory, "config.json"), "--port", "4177"]);
    expect(options.env.AGENTDOCK_API_TOKEN).toBeUndefined();
    const ownershipPath = join(directory, "data", "dsh-api-ownership.json");
    const ownership = readFileSync(ownershipPath, "utf8");
    expect(ownership).toContain('"pid":9001');
    expect(ownership).not.toContain(managedToken);
    expect(ownership).not.toContain(parentToken);

    await lease.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(existsSync(ownershipPath)).toBe(false);
  });

  it("refuses a running API whose token is not in AgentDock's managed location", async () => {
    const directory = fixtureDirectory();
    const unmanagedToken = "unmanaged-token-that-must-not-be-disclosed";
    const server = await healthServer(unmanagedToken);
    try {
      const port = Number((server.address() as { port: number }).port);
      const supervisor = new LoopbackApiSupervisor({
        config: fixtureConfig(),
        configPath: join(directory, "config.json"),
        port,
        apiCommand: { command: process.execPath, args: [] },
        spawn: (() => { throw new Error("an unmanaged API must not be replaced"); }) as never,
      });
      let received: unknown;
      try {
        await supervisor.start();
      } catch (error) {
        received = error;
      }
      expect(received).toMatchObject({ code: "MANAGED_TOKEN_UNAVAILABLE" });
      expect(String(received)).not.toContain(unmanagedToken);
    } finally {
      await close(server);
    }
  });

  it("does not replace an active dsh start lock", async () => {
    const directory = fixtureDirectory();
    const lockDirectory = join(directory, "data", "dsh-start.lock");
    mkdirSync(lockDirectory, { recursive: true });
    writeFileSync(join(lockDirectory, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), configPath: join(directory, "config.json") })}\n`);
    const spawn = vi.fn(() => new FakeChild(9003) as unknown as ChildProcess);
    const supervisor = new LoopbackApiSupervisor({
      config: fixtureConfig(),
      configPath: join(directory, "config.json"),
      apiCommand: { command: process.execPath, args: [] },
      spawn: spawn as never,
      fetch: async () => { throw new TypeError("connection refused"); },
    });

    await expect(supervisor.start()).rejects.toMatchObject({ code: "DSH_START_IN_PROGRESS" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("injects the token only into the DSH child and redacts it from relayed output", async () => {
    const token = "dsh-child-token-that-must-be-redacted";
    const original = process.env.AGENTDOCK_API_TOKEN;
    const child = new FakeChild(9002);
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    Object.assign(child, { stdout, stderr });
    const output: string[] = [];
    const errors: string[] = [];
    const spawn = vi.fn(() => {
      queueMicrotask(() => {
        stdout.emit("data", `DSH received ${token.slice(0, 11)}`);
        stdout.emit("data", `${token.slice(11)}\n`);
        stderr.emit("data", `DSH error ${token.slice(0, 7)}`);
        stderr.emit("data", `${token.slice(7)}\n`);
        child.emit("exit", 0, null);
      });
      return child as unknown as ChildProcess;
    });
    const launcher = new DshProcessLauncher({
      spawn: spawn as never,
      writeStdout: (data) => output.push(data),
      writeStderr: (data) => errors.push(data),
    });

    await expect(launcher.launch({ command: "fake-dsh", profile: "web", token })).resolves.toEqual({ exitCode: 0 });
    const [, args, options] = spawn.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(args).toEqual(["--profile", "web"]);
    expect(options.env.AGENTDOCK_API_TOKEN).toBe(token);
    expect(process.env.AGENTDOCK_API_TOKEN).toBe(original);
    expect(output.join("")).toContain("[REDACTED]");
    expect(errors.join("")).toContain("[REDACTED]");
    expect([...output, ...errors].join("")).not.toContain(token);
  });
});

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agentdock-dsh-launcher-"));
  directories.push(directory);
  return directory;
}

function fixtureConfig() {
  return validateConfig({ version: 1, dataDir: "data", engines: [], environments: [], agents: [], projects: [], environmentPermissions: [] });
}

function writeManagedToken(directory: string, token: string): void {
  const dataDirectory = join(directory, "data");
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(join(dataDirectory, "api-token"), `${token}\n`);
}

async function healthServer(token: string): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url !== "/api/v1/health") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end('{"healthy":true}');
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return server;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

class FakeChild extends EventEmitter {
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public killed = false;
  public readonly kill = vi.fn((signal?: NodeJS.Signals): boolean => {
    this.killed = true;
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit("exit", 0, signal ?? null);
    });
    return true;
  });

  public constructor(public readonly pid: number) {
    super();
  }
}
