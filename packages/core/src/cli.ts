#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig, ConfigValidationError } from "./config/load.js";
import { ConfigEditor } from "./config/editor.js";
import { resolveExecutionContext, formatDryRun } from "./policy/resolver.js";
import { configBaseDirectory, configDataPath, runtimeDescriptors } from "./runtime/configuration.js";
import { createConfiguredRuntimeRegistry } from "./runtime/registry.js";
import { LocalAdapterStore, localAdapterDirectory } from "./runtime/local-adapters.js";
import { doctor } from "./runtime/doctor.js";
import { RunService } from "./runtime/run-service.js";
import { SessionService } from "./runtime/session-service.js";
import { SqliteRunStore } from "./storage/sqlite-run-store.js";
import type { AdapterPermission } from "./adapter-contract/index.js";
import type { ExecutionContext, Run, RunEvent, RunRouteSnapshot, RunStatus } from "./core/types.js";
import { AgentDockError } from "./core/errors.js";
import { createAgentDockApiServer } from "./api/server.js";
import { EnvironmentDirectoryManager } from "./environment/manager.js";
import { configuredAgents } from "./config/model.js";
import { explainRoute, resolveRoute } from "./runtime/router.js";
import { DEFAULT_DSH_API_PORT, DshProcessLauncher, LoopbackApiSupervisor } from "./dsh-launcher/launcher.js";

function usage(): void {
  process.stdout.write([
    "AgentDock development CLI",
    "",
    "  agentdock config validate [path]",
    "  agentdock engine list [--config path]",
    "  agentdock engine health <engine-id> [--config path]",
    "  agentdock adapter install <local-package-path> [--config path]",
    "  agentdock adapter list [--config path]",
    "  agentdock adapter enable <adapter-name> [--grant permission] [--config path]",
    "  agentdock adapter disable <adapter-name> [--config path]",
    "  agentdock adapter uninstall <adapter-name> [--config path]",
    "  agentdock doctor [--config path]",
    "  agentdock api serve [--config path] [--port number] [--api-token token]",
    "  agentdock dsh start --dsh-command <path> [--config path] [--port number] [--profile name]",
    "  agentdock environment list [--config path]",
    "  agentdock environment rescan <environment-id> [--config path]",
    "  agentdock environment doctor <environment-id> [--config path]",
    "  agentdock environment template list [--config path]",
    "  agentdock environment template create <template-id> <source-environment-id> [--config path]",
    "  agentdock environment template apply <template-id> <new-environment-id> --confirm-high-risk [--config path]",
    "  agentdock agent list [--config path]",
    "  agentdock agent run <agent-id> [--format jsonl|human] [--dry-run] [options] <task>",
    "  agentdock project list [--config path]",
    "  agentdock project show [--config path] <project-id>",
    "  agentdock run dry-run [--agent id] [options] <task>",
    "  agentdock run execute [--agent id] [options] <task>",
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
  agentId?: string;
  environmentId?: string;
  projectId?: string;
  sessionId?: string;
  status?: RunStatus;
  limit?: number;
  port?: number;
  apiToken?: string;
  profile?: string;
  dshCommand?: string;
  confirmHighRisk: boolean;
  format?: "json" | "jsonl" | "human";
  dryRun: boolean;
  grantedPermissions: AdapterPermission[];
  positional: string[];
}

function parseOptions(args: string[]): ParsedOptions {
  const result: ParsedOptions = { configPath: ".agentdock/config.json", dryRun: false, confirmHighRisk: false, grantedPermissions: [], positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--config" && next) {
      result.configPath = next;
      index += 1;
    } else if (arg === "--agent" && next) {
      result.agentId = next;
      index += 1;
    } else if (arg === "--environment" && next) {
      result.environmentId = next;
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
    } else if (arg === "--profile" && next) {
      result.profile = next;
      index += 1;
    } else if (arg === "--dsh-command" && next) {
      result.dshCommand = next;
      index += 1;
    } else if (arg === "--format" && (next === "json" || next === "jsonl" || next === "human")) {
      result.format = next;
      index += 1;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--confirm-high-risk") {
      result.confirmHighRisk = true;
    } else if (arg === "--grant" && next) {
      result.grantedPermissions.push(next as AdapterPermission);
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
  const [rawGroup, rawCommand, ...rawRest] = process.argv.slice(2);
  if (rawGroup === "agent" && rawCommand === "list") {
    const options = parseOptions(rawRest);
    try {
      const config = await loadValidatedConfig(options.configPath);
      process.stdout.write(`${JSON.stringify(configuredAgents(config), null, 2)}\n`);
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }
  if (rawGroup === "agent" && rawCommand === "run" && !rawRest[0]) {
    usage();
    process.exitCode = 1;
    return;
  }
  const agentRunAlias = rawGroup === "agent" && rawCommand === "run";
  const agentRunDryRun = agentRunAlias && rawRest.includes("--dry-run");
  const group = agentRunAlias ? "run" : rawGroup;
  const command = agentRunAlias ? (agentRunDryRun ? "dry-run" : "execute") : rawCommand;
  const rest = agentRunAlias ? ["--agent", rawRest[0] as string, ...rawRest.slice(1)] : rawRest;
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

  if (group === "engine" && command === "list") {
    const options = parseOptions(rest);
    try {
      const config = await loadValidatedConfig(options.configPath);
      const adapters = await createConfiguredRuntimeRegistry(config, options.configPath);
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

  if (group === "engine" && command === "health") {
    const options = parseOptions(rest);
    const engineId = options.positional[0];
    if (!engineId) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      const engine = runtimeDescriptors(config).find((item) => item.id === engineId);
      if (!engine) throw new Error(`Engine "${engineId}" was not found.`);
      const registry = await createConfiguredRuntimeRegistry(config, options.configPath);
      const adapter = registry.create(engine);
      process.stdout.write(`${JSON.stringify(await adapter.healthCheck(), null, 2)}\n`);
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "adapter" && (command === "install" || command === "list" || command === "enable" || command === "disable" || command === "uninstall")) {
    const options = parseOptions(rest);
    const nameOrPath = options.positional[0];
    if (command !== "list" && !nameOrPath) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      const store = new LocalAdapterStore(localAdapterDirectory(config, options.configPath));
      if (command === "install") {
        process.stdout.write(`${JSON.stringify(store.install(nameOrPath as string), null, 2)}\n`);
      } else if (command === "list") {
        process.stdout.write(`${JSON.stringify(store.list(), null, 2)}\n`);
      } else if (command === "enable") {
        process.stdout.write(`${JSON.stringify(store.enable(nameOrPath as string, options.grantedPermissions), null, 2)}\n`);
      } else if (command === "disable") {
        process.stdout.write(`${JSON.stringify(store.disable(nameOrPath as string), null, 2)}\n`);
      } else {
        store.uninstall(nameOrPath as string);
        process.stdout.write(`${JSON.stringify({ name: nameOrPath, uninstalled: true }, null, 2)}\n`);
      }
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
      const registry = await createConfiguredRuntimeRegistry(config, options.configPath);
      const report = await doctor({ config, configPath: options.configPath, registry });
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
      const registry = await createConfiguredRuntimeRegistry(config, options.configPath);
      const api = createAgentDockApiServer({
        config,
        configPath: options.configPath,
        registry,
        registryFactory: createConfiguredRuntimeRegistry,
        ...(options.apiToken ? { apiToken: options.apiToken } : {}),
      });
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

  if (group === "dsh" && command === "start") {
    const options = parseOptions(rest);
    try {
      if (!options.dshCommand) {
        throw new AgentDockError("DSH_COMMAND_REQUIRED", "dsh start requires --dsh-command until a compatible DSH CLI is detected.");
      }
      const config = await loadValidatedConfig(options.configPath);
      const supervisor = new LoopbackApiSupervisor({
        config,
        configPath: options.configPath,
        port: options.port ?? DEFAULT_DSH_API_PORT,
        apiCommand: currentCliLaunchCommand(),
      });
      const lease = await supervisor.start();
      const controller = new AbortController();
      const onInterrupt = (signal: "SIGINT" | "SIGTERM"): void => {
        controller.abort();
        process.exitCode = signal === "SIGINT" ? 130 : 143;
      };
      const onSigint = (): void => onInterrupt("SIGINT");
      const onSigterm = (): void => onInterrupt("SIGTERM");
      process.once("SIGINT", onSigint);
      process.once("SIGTERM", onSigterm);
      try {
        process.stdout.write(`${JSON.stringify({ apiBaseUrl: lease.apiBaseUrl, apiOwnership: lease.ownership, dsh: { status: "starting", ...(options.profile ? { profile: options.profile } : {}) } })}\n`);
        const result = await lease.launchDsh(new DshProcessLauncher(), {
          command: options.dshCommand,
          ...(options.profile ? { profile: options.profile } : {}),
          signal: controller.signal,
        });
        if (result.exitCode !== 0 && process.exitCode === undefined) process.exitCode = result.exitCode ?? 1;
      } finally {
        process.removeListener("SIGINT", onSigint);
        process.removeListener("SIGTERM", onSigterm);
        await lease.stop();
      }
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
      if (agentRunAlias && options.environmentId) {
        throw new AgentDockError("AGENT_ENVIRONMENT_OVERRIDE_UNSUPPORTED", "agent run selects the Environment from the Agent binding; use run dry-run for explicit advanced Environment routing.");
      }
      const config = await loadValidatedConfig(options.configPath);
      const routeInput = {
        ...(options.agentId ? { agentId: options.agentId } : {}),
        ...(options.environmentId ? { environmentId: options.environmentId } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
      };
      const routeExplanation = explainRoute(config, routeInput);
      if (!routeExplanation.resolved) {
        process.stdout.write(`${JSON.stringify({ task, executes: false, routing: routeExplanation, error: routeExplanation.error }, null, 2)}\n`);
        return;
      }
      const { resolved: _resolved, ...routing } = routeExplanation;
      const context = resolveExecutionContext({
        config,
        baseDirectory: configBaseDirectory(options.configPath),
        ...(routing.agentId ? { agentId: routing.agentId } : {}),
        ...(routing.environmentId ? { environmentId: routing.environmentId } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
      });
      process.stdout.write(`${JSON.stringify(formatDryRun(context, task, routing as RunRouteSnapshot), null, 2)}\n`);
      return;
    } catch (error) {
      if (agentRunAlias && (options.format ?? "jsonl") === "jsonl") writeAgentRunError(error);
      else printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "run" && command === "execute") {
    const options = parseOptions(rest);
    const agentOutputFormat = agentRunAlias ? options.format ?? "jsonl" : undefined;
    const task = options.positional.join(" ").trim();
    if (!task) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      if (agentRunAlias && options.environmentId) {
        throw new AgentDockError("AGENT_ENVIRONMENT_OVERRIDE_UNSUPPORTED", "agent run selects the Environment from the Agent binding; use run execute for explicit advanced Environment routing.");
      }
      if (agentOutputFormat && agentOutputFormat !== "jsonl" && agentOutputFormat !== "human") {
        throw new AgentDockError("INVALID_FORMAT", 'agent run supports only "jsonl" (default) and "human" formats.');
      }
      const config = await loadValidatedConfig(options.configPath);
      const routing = resolveRoute(config, {
        ...(options.agentId ? { agentId: options.agentId } : {}),
        ...(options.environmentId ? { environmentId: options.environmentId } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
      });
      let context = resolveExecutionContext({
        config,
        baseDirectory: configBaseDirectory(options.configPath),
        ...(routing.agentId ? { agentId: routing.agentId } : {}),
        environmentId: routing.environmentId,
        ...(options.projectId ? { projectId: options.projectId } : {}),
      });
      const environmentManager = new EnvironmentDirectoryManager(config, configBaseDirectory(options.configPath));
      const manifest = await environmentManager.prepareForRun(context.agentEnvironment.id);
      const runId = randomUUID();
      const environmentLock = environmentManager.acquireRunLock(context.agentEnvironment.id, runId, manifest.configHash);
      try {
      context = resolveExecutionContext({
        config,
        baseDirectory: configBaseDirectory(options.configPath),
        environmentId: context.agentEnvironment.id,
        ...(routing.agentId ? { agentId: routing.agentId } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
      });
      const registry = await createConfiguredRuntimeRegistry(config, options.configPath);
      const adapter = registry.create(context.engine);
      const store = new SqliteRunStore(configDataPath(config, options.configPath), config.storage);
      store.recoverStaleRuns();
      const service = new RunService(store);
      const controller = new AbortController();
      const onInterrupt = (): void => controller.abort();
      process.once("SIGINT", onInterrupt);
      try {
        let finalStatus: RunStatus | undefined;
        let finalRun: Run | undefined;
        const iterator = service.execute({
          context,
          task,
          adapter,
          ...(options.sessionId ? { sessionId: options.sessionId } : {}),
          runId,
          signal: controller.signal,
          redaction: config.redaction,
          routing: routing as RunRouteSnapshot,
        })[Symbol.asyncIterator]();
        let next = await iterator.next();
        if (next.done || !next.value) throw new Error("The Run ended before it produced its accepted event.");
        if (agentOutputFormat) writeAgentRunAccepted(next.value.run, context, options.configPath, agentOutputFormat);
        while (!next.done && next.value) {
          const result = next.value;
          if (agentOutputFormat) writeAgentRunEvent(result.event, agentOutputFormat);
          else process.stdout.write(`${JSON.stringify(result.event)}\n`);
          finalStatus = result.run.status;
          finalRun = result.run;
          next = await iterator.next();
        }
        if (agentOutputFormat && finalRun) writeAgentRunResult(finalRun, agentOutputFormat);
        try {
          await environmentManager.reconcileAfterRun(context.agentEnvironment.id, finalRun?.snapshot.environmentConfigHash, environmentLock.runId);
        } catch (error) {
          process.stderr.write(`Warning: could not refresh Environment manifest after Run: ${error instanceof Error ? error.message : String(error)}\n`);
        }
        if (finalStatus === "cancelled") process.exitCode = 130;
        else if (finalStatus === "failed" || finalStatus === "timed_out") process.exitCode = 3;
      } finally {
        process.removeListener("SIGINT", onInterrupt);
        store.close();
      }
      return;
      } finally {
        environmentLock.release();
      }
    } catch (error) {
      if (agentRunAlias && (options.format ?? "jsonl") === "jsonl") writeAgentRunError(error);
      else printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "environment" && (command === "list" || command === "rescan")) {
    const options = parseOptions(rest);
    const environmentId = options.positional[0];
    if (command === "rescan" && !environmentId) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      if (command === "list") {
        process.stdout.write(`${JSON.stringify(config.environments, null, 2)}\n`);
      } else {
        const manager = new EnvironmentDirectoryManager(config, configBaseDirectory(options.configPath));
        process.stdout.write(`${JSON.stringify(await manager.rescan(environmentId as string), null, 2)}\n`);
      }
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "environment" && command === "doctor") {
    const options = parseOptions(rest);
    const environmentId = options.positional[0];
    if (!environmentId) {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      const registry = await createConfiguredRuntimeRegistry(config, options.configPath);
      const report = await doctor({ config, configPath: options.configPath, registry, environmentId });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.healthy) process.exitCode = 2;
      return;
    } catch (error) {
      printError(error);
      process.exitCode = 2;
      return;
    }
  }

  if (group === "environment" && command === "template") {
    const [templateCommand, ...templateRest] = rest;
    const options = parseOptions(templateRest);
    const templateId = options.positional[0];
    const sourceOrTargetEnvironmentId = options.positional[1];
    if ((templateCommand === "create" || templateCommand === "apply") && (!templateId || !sourceOrTargetEnvironmentId)) {
      usage();
      process.exitCode = 1;
      return;
    }
    if (templateCommand !== "list" && templateCommand !== "create" && templateCommand !== "apply") {
      usage();
      process.exitCode = 1;
      return;
    }
    try {
      const config = await loadValidatedConfig(options.configPath);
      const baseDirectory = configBaseDirectory(options.configPath);
      const directories = new EnvironmentDirectoryManager(config, baseDirectory);
      if (templateCommand === "list") {
        process.stdout.write(`${JSON.stringify(await directories.templates(), null, 2)}\n`);
        return;
      }
      if (templateCommand === "create") {
        process.stdout.write(`${JSON.stringify(await directories.createTemplate(templateId as string, sourceOrTargetEnvironmentId as string), null, 2)}\n`);
        return;
      }

      const targetEnvironmentId = sourceOrTargetEnvironmentId as string;
      const template = (await directories.templates()).find((item) => item.id === templateId);
      if (!template) throw new AgentDockError("ENVIRONMENT_TEMPLATE_NOT_FOUND", `Environment template "${templateId}" was not found.`);
      if (config.environments.some((item) => item.id === targetEnvironmentId)) {
        throw new AgentDockError("ENVIRONMENT_ALREADY_EXISTS", `Environment "${targetEnvironmentId}" already exists.`);
      }
      const sourceEnvironment = config.environments.find((item) => item.id === template.sourceEnvironmentId);
      if (!sourceEnvironment) throw new AgentDockError("ENVIRONMENT_NOT_FOUND", `Template source Environment "${template.sourceEnvironmentId}" is no longer configured. Use the API to supply a new managed Environment definition.`);
      const { homeDir: _homeDir, configDir: _configDir, stateDir: _stateDir, cacheDir: _cacheDir, ...portableEnvironment } = sourceEnvironment;
      const newEnvironment = { ...portableEnvironment, id: targetEnvironmentId, directoryMode: "managed" as const };
      const editor = new ConfigEditor(options.configPath, config);
      const snapshot = await editor.snapshot();
      const candidate = structuredClone(snapshot.config);
      candidate.environments.push(newEnvironment);
      const preview = await editor.preview(candidate);
      if (preview.highRisk.required && !options.confirmHighRisk) {
        throw new AgentDockError("CONFIG_CONFIRMATION_REQUIRED", "Creating a managed Environment changes native directory ownership. Retry with --confirm-high-risk after reviewing the configuration.");
      }
      const manifest = await new EnvironmentDirectoryManager(preview.candidate, baseDirectory).applyTemplate(templateId as string, targetEnvironmentId);
      const saved = await editor.save(preview.candidate, snapshot.revision, snapshot.hash, options.confirmHighRisk);
      process.stdout.write(`${JSON.stringify({ templateId, environment: newEnvironment, manifest, revision: saved.current.revision, hash: saved.current.hash }, null, 2)}\n`);
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
      const store = new SqliteRunStore(configDataPath(config, options.configPath), config.storage);
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
      const store = new SqliteRunStore(configDataPath(config, options.configPath), config.storage);
      try {
        store.recoverStaleRuns();
        if (command === "create") {
          let context = resolveExecutionContext({
            config,
            baseDirectory: configBaseDirectory(options.configPath),
            ...(options.agentId ? { agentId: options.agentId } : {}),
            ...(options.environmentId ? { environmentId: options.environmentId } : {}),
            ...(options.projectId ? { projectId: options.projectId } : {}),
          });
          await new EnvironmentDirectoryManager(config, configBaseDirectory(options.configPath)).rescan(context.agentEnvironment.id);
          context = resolveExecutionContext({
            config,
            baseDirectory: configBaseDirectory(options.configPath),
            environmentId: context.agentEnvironment.id,
            ...(options.agentId ? { agentId: options.agentId } : {}),
            ...(options.projectId ? { projectId: options.projectId } : {}),
          });
          const registry = await createConfiguredRuntimeRegistry(config, options.configPath);
          const session = await new SessionService(store).create(context, registry.create(context.engine));
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

type AgentRunOutputFormat = "jsonl" | "human";

function writeAgentRunAccepted(run: Run, context: ExecutionContext, configPath: string, format: AgentRunOutputFormat): void {
  if (format === "human") {
    process.stdout.write(`Run ${run.id} accepted for Agent ${context.agent?.id ?? run.agentId ?? "(advanced route)"}.\n`);
    return;
  }
  writeJsonLine({
    type: "accepted",
    runId: run.id,
    ...(context.agent ? { agent: { id: context.agent.id, engineId: context.agent.engineId, environmentId: context.agent.environmentId, permissionId: context.agent.permissionId } } : {}),
    ...(context.project ? { project: { id: context.project.id } } : {}),
    ...(run.sessionId ? { session: { id: run.sessionId } } : {}),
    recovery: { command: "run events", args: ["--config", configPath, run.id] },
  });
}

function writeAgentRunEvent(event: RunEvent, format: AgentRunOutputFormat): void {
  if (format === "jsonl") {
    writeJsonLine({ type: "event", event });
    return;
  }
  if (event.type === "message") {
    const text = typeof event.payload.text === "string" ? event.payload.text : undefined;
    if (text) process.stdout.write(`${text}\n`);
    return;
  }
  if (event.type === "tool_call") {
    process.stdout.write(`Tool started: ${eventLabel(event)}\n`);
    return;
  }
  if (event.type === "tool_result") {
    process.stdout.write(`Tool finished: ${eventLabel(event)}\n`);
    return;
  }
  if (event.type === "error") {
    const message = typeof event.payload.message === "string" ? event.payload.message : eventLabel(event);
    process.stdout.write(`Error: ${message}\n`);
  }
}

function writeAgentRunResult(run: Run, format: AgentRunOutputFormat): void {
  if (format === "human") {
    process.stdout.write(`Run ${run.id} ${run.status}.\n`);
    return;
  }
  writeJsonLine({
    type: "result",
    runId: run.id,
    status: run.status,
    ...(run.sessionId ? { sessionId: run.sessionId } : {}),
    ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}),
    ...(run.errorCode ? { errorCode: run.errorCode } : {}),
  });
}

function writeAgentRunError(error: unknown): void {
  const code = error instanceof AgentDockError ? error.code : error instanceof ConfigValidationError ? "CONFIG_VALIDATION_FAILED" : "AGENT_RUN_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  writeJsonLine({ type: "error", error: { code, message } });
}

function eventLabel(event: RunEvent): string {
  for (const key of ["tool", "toolName", "name", "command", "errorCode"]) {
    if (typeof event.payload[key] === "string") return event.payload[key] as string;
  }
  return event.type;
}

function writeJsonLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function currentCliLaunchCommand(): { command: string; args: string[] } {
  const entrypoint = process.argv[1];
  if (!entrypoint) throw new AgentDockError("MANAGED_API_START_FAILED", "The AgentDock CLI entrypoint could not be determined for dsh start.");
  // A development invocation commonly runs src/cli.ts through tsx. Its child
  // API should use the already-built JavaScript entrypoint rather than assuming
  // Node can execute TypeScript imports directly.
  const compiledEntrypoint = entrypoint.endsWith(".ts")
    ? resolve(dirname(entrypoint), "../dist/cli.js")
    : resolve(entrypoint);
  if (!existsSync(compiledEntrypoint)) {
    throw new AgentDockError("MANAGED_API_START_FAILED", "The AgentDock CLI build is required before dsh start can launch a managed API.");
  }
  return { command: process.execPath, args: [compiledEntrypoint] };
}

function printError(error: unknown): void {
  if (error instanceof ConfigValidationError) {
    process.stderr.write(`${error.message}\n`);
    for (const issue of error.issues) process.stderr.write(`- ${issue.path}: ${issue.message}\n`);
    return;
  }
  if (error instanceof AgentDockError) {
    process.stderr.write(`${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`);
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
