#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { loadConfig, ConfigValidationError } from "./config/load.js";
import { resolveExecutionContext, formatDryRun } from "./policy/resolver.js";
import { configBaseDirectory, configDataPath, runtimeDescriptors } from "./runtime/configuration.js";
import { createBuiltinRuntimeRegistry } from "./runtime/registry.js";
import { doctor } from "./runtime/doctor.js";
import { RunService } from "./runtime/run-service.js";
import { SessionService } from "./runtime/session-service.js";
import { SqliteRunStore } from "./storage/sqlite-run-store.js";
import type { RunStatus } from "./core/types.js";
import { createAgentDockApiServer } from "./api/server.js";

function usage(): void {
  process.stdout.write([
    "AgentDock development CLI",
    "",
    "  agentdock config validate [path]",
    "  agentdock runtime list [--config path]",
    "  agentdock runtime health <runtime-id> [--config path]",
    "  agentdock doctor [--config path]",
    "  agentdock api serve [--config path] [--port number] [--api-token token]",
    "  agentdock profile list [--config path]",
    "  agentdock project list [--config path]",
    "  agentdock project show [--config path] <project-id>",
    "  agentdock run dry-run [options] <task>",
    "  agentdock run execute [options] <task>",
    "  agentdock run list [options]",
    "  agentdock run show [options] <run-id>",
    "  agentdock run events [options] <run-id>",
    "  agentdock run export [--format json|jsonl] [options] <run-id>",
    "  agentdock session create [options]",
    "  agentdock session list [--config path]",
    "  agentdock session show [--config path] <session-id>",
    "  agentdock session archive [--config path] <session-id>",
    "",
    "The default config path is .agentdock/config.json.",
    "",
  ].join("\n"));
}

interface ParsedOptions {
  configPath: string;
  profileId?: string;
  projectId?: string;
  sessionId?: string;
  status?: RunStatus;
  limit?: number;
  port?: number;
  apiToken?: string;
  format?: "json" | "jsonl";
  positional: string[];
}

function parseOptions(args: string[]): ParsedOptions {
  const result: ParsedOptions = { configPath: ".agentdock/config.json", positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--config" && next) {
      result.configPath = next;
      index += 1;
    } else if (arg === "--profile" && next) {
      result.profileId = next;
      index += 1;
    } else if (arg === "--project" && next) {
      result.projectId = next;
      index += 1;
    } else if (arg === "--session" && next) {
      result.sessionId = next;
      index += 1;
    } else if (arg === "--status" && next) {
      result.status = next as RunStatus;
      index += 1;
    } else if (arg === "--limit" && next) {
      result.limit = Number(next);
      index += 1;
    } else if (arg === "--port" && next) {
      result.port = Number(next);
      index += 1;
    } else if (arg === "--api-token" && next) {
      result.apiToken = next;
      index += 1;
    } else if (arg === "--format" && (next === "json" || next === "jsonl")) {
      result.format = next;
      index += 1;
    } else if (arg) {
      result.positional.push(arg);
    }
  }
  return result;
}

async function loadValidatedConfig(configPath: string) {
  return loadConfig(configPath);
}

async function main(): Promise<void> {
  const [group, command, ...rest] = process.argv.slice(2);
  if (group === "config" && command === "validate") {
    const path = rest[0] ?? ".agentdock/config.json";
    try {
      const config = await loadConfig(path);
      process.stdout.write(`Valid configuration (version ${config.version}).\n`);
      return;
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        process.stderr.write(`${error.message}\n`);
        for (const issue of error.issues) {
          process.stderr.write(`- ${issue.path}: ${issue.message}\n`);
        }
        process.exitCode = 2;
        return;
      }
      throw error;
    }
  }

  if (group === "runtime" && command === "list") {
    const options = parseOptions(rest);
    try {
      const config = await loadValidatedConfig(options.configPath);
      const adapters = createBuiltinRuntimeRegistry();
      for (const runtime of runtimeDescriptors(config)) {
        const registered = adapters.list().includes(runtime.adapter) ? "registered" : "missing-adapter";
        process.stdout.write(`${runtime.id}\t${runtime.adapter}\t${runtime.binary ?? "(default)"}\t${runtime.enabled ? "enabled" : "disabled"}\t${registered}\n`);
      }
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "runtime" && command === "health") {
    const options = parseOptions(rest);
    const runtimeId = options.positional[0];
    if (!runtimeId) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      const runtime = runtimeDescriptors(config).find((item) => item.id === runtimeId);
      if (!runtime) throw new Error(`Runtime "${runtimeId}" was not found.`);
      const adapter = createBuiltinRuntimeRegistry().create(runtime);
      process.stdout.write(`${JSON.stringify(await adapter.healthCheck(), null, 2)}\n`);
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "doctor") {
    const options = parseOptions(command ? [command, ...rest] : rest);
    try {
      const config = await loadValidatedConfig(options.configPath);
      const report = await doctor({ config, configPath: options.configPath });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.healthy) process.exitCode = 2;
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "api" && command === "serve") {
    const options = parseOptions(rest);
    try {
      const config = await loadValidatedConfig(options.configPath);
      const api = createAgentDockApiServer({ config, configPath: options.configPath, ...(options.apiToken ? { apiToken: options.apiToken } : {}) });
      const address = await api.listen(options.port);
      process.stdout.write(`${JSON.stringify({ listening: true, host: address.host, port: address.port, apiBaseUrl: `http://${address.host}:${address.port}/api/v1`, authentication: "bearer", ...(!options.apiToken && !process.env.AGENTDOCK_API_TOKEN ? { tokenFile: join(dirname(configDataPath(config, options.configPath)), "api-token") } : {}) })}\n`);
      await waitForShutdown(api);
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "run" && command === "dry-run") {
    const options = parseOptions(rest);
    const task = options.positional.join(" ").trim();
    if (!task) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      const context = resolveExecutionContext({
        config,
        baseDirectory: configBaseDirectory(options.configPath),
        ...(options.profileId ? { profileId: options.profileId } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
      });
      process.stdout.write(`${JSON.stringify(formatDryRun(context, task), null, 2)}\n`);
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "run" && command === "execute") {
    const options = parseOptions(rest);
    const task = options.positional.join(" ").trim();
    if (!task) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      const context = resolveExecutionContext({
        config,
        baseDirectory: configBaseDirectory(options.configPath),
        ...(options.profileId ? { profileId: options.profileId } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
      });
      const adapter = createBuiltinRuntimeRegistry().create(context.runtime);
      const store = new SqliteRunStore(configDataPath(config, options.configPath));
      store.recoverStaleRuns();
      const service = new RunService(store);
      const controller = new AbortController();
      const onInterrupt = (): void => controller.abort();
      process.once("SIGINT", onInterrupt);
      try {
        let finalStatus: RunStatus | undefined;
        for await (const result of service.execute({
          context,
          task,
          adapter,
          ...(options.sessionId ? { sessionId: options.sessionId } : {}),
          signal: controller.signal,
        })) {
          process.stdout.write(`${JSON.stringify(result.event)}\n`);
          finalStatus = result.run.status;
        }
        if (finalStatus === "cancelled") process.exitCode = 130;
        else if (finalStatus === "failed" || finalStatus === "timed_out") process.exitCode = 3;
      } finally {
        process.removeListener("SIGINT", onInterrupt);
        store.close();
      }
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "profile" && command === "list") {
    const options = parseOptions(rest);
    try {
      const config = await loadValidatedConfig(options.configPath);
      process.stdout.write(`${JSON.stringify(config.profiles, null, 2)}\n`);
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "project" && (command === "list" || command === "show")) {
    const options = parseOptions(rest);
    const id = options.positional[0];
    if (command === "show" && !id) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      if (command === "list") {
        process.stdout.write(`${JSON.stringify(config.projects, null, 2)}\n`);
      } else {
        const project = config.projects.find((item) => item.id === id);
        if (!project) throw new Error(`Project "${id}" was not found.`);
        process.stdout.write(`${JSON.stringify(project, null, 2)}\n`);
      }
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "run" && (command === "list" || command === "show" || command === "events" || command === "export")) {
    const options = parseOptions(rest);
    const id = options.positional[0];
    if ((command === "show" || command === "events" || command === "export") && !id) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      const store = new SqliteRunStore(configDataPath(config, options.configPath));
      try {
        store.recoverStaleRuns();
        if (command === "list") {
          process.stdout.write(`${JSON.stringify(store.listRuns({ ...(options.status ? { status: options.status } : {}), ...(options.projectId ? { projectId: options.projectId } : {}), ...(options.limit ? { limit: options.limit } : {}) }), null, 2)}\n`);
        } else if (command === "show") {
          const run = store.getRun(id as string);
          if (!run) throw new Error(`Run "${id}" was not found.`);
          process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
        } else if (command === "events") {
          process.stdout.write(`${JSON.stringify(store.listEvents(id as string), null, 2)}\n`);
        } else {
          const run = store.getRun(id as string);
          if (!run) throw new Error(`Run "${id}" was not found.`);
          const events = store.listEvents(id as string);
          if (options.format === "jsonl") {
            process.stdout.write(`${JSON.stringify({ kind: "run", run })}\n`);
            for (const event of events) process.stdout.write(`${JSON.stringify({ kind: "event", event })}\n`);
          } else {
            process.stdout.write(`${JSON.stringify({ run, events }, null, 2)}\n`);
          }
        }
      } finally {
        store.close();
      }
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "session" && (command === "create" || command === "list" || command === "show" || command === "archive")) {
    const options = parseOptions(rest);
    const id = options.positional[0];
    if ((command === "show" || command === "archive") && !id) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      const store = new SqliteRunStore(configDataPath(config, options.configPath));
      try {
        store.recoverStaleRuns();
        if (command === "create") {
          const context = resolveExecutionContext({
            config,
            baseDirectory: configBaseDirectory(options.configPath),
            ...(options.profileId ? { profileId: options.profileId } : {}),
            ...(options.projectId ? { projectId: options.projectId } : {}),
          });
          const session = await new SessionService(store).create(context, createBuiltinRuntimeRegistry().create(context.runtime));
          process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
        } else if (command === "list") {
          process.stdout.write(`${JSON.stringify(store.listSessions(), null, 2)}\n`);
        } else if (command === "show") {
          const session = store.getSession(id as string);
          if (!session) throw new Error(`Session "${id}" was not found.`);
          process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
        } else {
          process.stdout.write(`${JSON.stringify(new SessionService(store).archive(id as string), null, 2)}\n`);
        }
      } finally {
        store.close();
      }
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  usage();
  process.exitCode = 1;
}

function printError(error: unknown): void {
  if (error instanceof ConfigValidationError) {
    process.stderr.write(`${error.message}\n`);
    for (const issue of error.issues) process.stderr.write(`- ${issue.path}: ${issue.message}\n`);
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}

async function waitForShutdown(api: { close(): Promise<void> }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      void api.close().then(resolve, reject);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
