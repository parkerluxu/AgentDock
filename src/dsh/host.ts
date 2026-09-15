import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { ConfigEditor, ConfigEditorError } from "../config/editor.js";
import { ConfigValidationError } from "../config/load.js";
import type { AgentDockConfig } from "../config/schema.js";
import { AgentDockGateway, type AgentDockGatewayConfig } from "./gateway.js";
import { AgentDockLlmAdapter } from "./llm-adapter.js";

/** The authenticated Connection carrier used by the DSH Web client. */
export const RPC_CHANNEL = "/api";
export const RPC_METHOD = "agentDock";

export interface AgentDockDshConfig extends AgentDockGatewayConfig {
  /** AgentDock configuration file. Relative paths are resolved from `dsh`'s working directory. */
  configPath?: string;
}

interface DshContext {
  inject(dependencies: string[], callback: (context: DshContext) => unknown): unknown;
  effect?(callback: () => void | (() => void), name?: string): unknown;
  get(name: string): unknown;
  logger?: { info(message: string): void; warn(message: string): void };
  llm?: { registerAdapter(providers: string[], adapter: AgentDockLlmAdapter): () => void };
  sessionController?: { selectModel(request: { sessionId: string; provider: string; model: string }): Promise<unknown> };
  connection?: {
    fetch: {
      register(route: {
        path: string;
        methods: string[];
        requestBody: "buffered";
        fetch(request: Request): Promise<Response>;
      }): unknown;
    };
  };
}

/** The provider and session-controller services must be ready before this bundle activates. */
export const inject = ["connection", "llm", "sessionController"];

interface RpcEnvelope {
  method?: unknown;
  rpcId?: unknown;
  payload?: unknown;
}

interface RoutedPayload {
  endpoint: string;
  payload: unknown;
}

const EMPTY_CONFIG: AgentDockConfig = {
  version: 1,
  storage: { saveOutput: true },
  logging: { level: "warn" },
  redaction: { additionalKeys: [] },
  engines: [],
  environments: [],
  agents: [],
  projects: [],
  environmentPermissions: [],
};

/**
 * DSH host entry. It deliberately uses the existing authenticated Connection
 * route instead of exposing another HTTP listener, so config operations remain
 * local to the running Harness profile.
 */
export function apply(ctx: DshContext, rawConfig: AgentDockDshConfig = {}): void {
  const configPath = resolveConfigPath(rawConfig.configPath);
  const editor = new ConfigEditor(configPath, EMPTY_CONFIG);
  const gateway = new AgentDockGateway(rawConfig);
  if (!ctx.llm) throw new Error("AgentDock DSH plugin requires the DSH LLM service.");
  const registerAdapter = (): (() => void) => ctx.llm!.registerAdapter(["agentdock"], new AgentDockLlmAdapter(gateway));
  if (ctx.effect) ctx.effect(registerAdapter, "agentdock-dsh: LLM provider");
  else registerAdapter();

  ctx.inject(["connection"], (connectionCtx) => {
    const connection = connectionCtx.connection;
    if (!connection) throw new Error("AgentDock DSH plugin requires the DSH connection service.");
    return connection.fetch.register({
      path: `${RPC_CHANNEL}/${RPC_METHOD}`,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: (request) => handleFetch(request, editor, configPath, gateway, ctx.sessionController),
    });
  });
  ctx.logger?.info(`[agentdock-dsh] configuration manager ready for ${configPath}`);
}

async function handleFetch(
  request: Request,
  editor: ConfigEditor,
  configPath: string,
  gateway: AgentDockGateway,
  sessionController: DshContext["sessionController"],
): Promise<Response> {
  let envelope: RpcEnvelope;
  try {
    envelope = await request.json() as RpcEnvelope;
  } catch {
    return new Response("body is not JSON", { status: 400 });
  }
  if (envelope.method !== RPC_METHOD || typeof envelope.rpcId !== "string" || !isRecord(envelope.payload)) {
    return new Response("invalid AgentDock RPC envelope", { status: 400 });
  }
  const routed = parseRoutedPayload(envelope.payload);
  if (!routed) return new Response("invalid AgentDock RPC request", { status: 400 });
  const result = await dispatch(routed, editor, configPath, gateway, sessionController, request.signal);
  return Response.json({ type: "server-response", rpcId: envelope.rpcId, result });
}

async function dispatch(
  routed: RoutedPayload,
  editor: ConfigEditor,
  configPath: string,
  gateway: AgentDockGateway,
  sessionController: DshContext["sessionController"],
  signal: AbortSignal,
): Promise<unknown> {
  try {
    if (signal.aborted) return failure("cancelled", "AgentDock request was cancelled.");
    switch (routed.endpoint) {
      case "snapshot":
        requireEmpty(routed.payload);
        return success({ ...(await editor.snapshot()), configPath });
      case "preview": {
        const payload = requireRecord(routed.payload);
        return success(await editor.preview(payload.config, optionalDryRun(payload.dryRun)));
      }
      case "save": {
        const payload = requireRecord(routed.payload);
        return success(await editor.save(
          payload.config,
          requireString(payload.revision, "revision"),
          requireString(payload.hash, "hash"),
          payload.confirmHighRisk === true,
          optionalDryRun(payload.dryRun),
        ));
      }
      case "backups":
        requireEmpty(routed.payload);
        return success({ backups: await editor.backups() });
      case "restore": {
        const payload = requireRecord(routed.payload);
        return success(await editor.restore(
          requireString(payload.backupId, "backupId"),
          requireString(payload.revision, "revision"),
          requireString(payload.hash, "hash"),
          payload.confirmHighRisk === true,
        ));
      }
      case "backend/catalog":
        requireEmpty(routed.payload);
        return success(await gateway.catalog(signal));
      case "backend/binding": {
        const payload = requireRecord(routed.payload);
        return success({ binding: await gateway.binding(requireString(payload.sessionId, "sessionId")) ?? null });
      }
      case "backend/bind": {
        const payload = requireRecord(routed.payload);
        const sessionId = requireString(payload.sessionId, "sessionId");
        const projectId = payload.projectId === undefined ? undefined : requireString(payload.projectId, "projectId");
        const binding = await gateway.bind({
          dshSessionId: sessionId,
          agentId: requireString(payload.agentId, "agentId"),
          ...(projectId === undefined ? {} : { projectId }),
        });
        if (!sessionController) throw new Error("DSH session controller is not available.");
        await sessionController.selectModel({ sessionId, provider: "agentdock", model: "bound" });
        return success({ binding, selectedModel: { provider: "agentdock", model: "bound" } });
      }
      case "backend/unbind": {
        const payload = requireRecord(routed.payload);
        return success({ deleted: await gateway.unbind(requireString(payload.sessionId, "sessionId")) });
      }
      default:
        return failure("not-found", `Unknown AgentDock endpoint "${routed.endpoint}".`);
    }
  } catch (error) {
    return toFailure(error);
  }
}

function resolveConfigPath(value: string | undefined): string {
  const supplied = value?.trim();
  if (!supplied) return resolve(homedir(), ".agentdock", "config.json");
  return isAbsolute(supplied) ? supplied : resolve(process.cwd(), supplied);
}

function parseRoutedPayload(value: Record<string, unknown>): RoutedPayload | undefined {
  if (typeof value.endpoint !== "string" || value.endpoint.length === 0 || value.endpoint.length > 100 || !("payload" in value)) return undefined;
  return { endpoint: value.endpoint, payload: value.payload };
}

function optionalDryRun(value: unknown): { task: string; agentId?: string; environmentId?: string; projectId?: string } | undefined {
  if (value === undefined) return undefined;
  const input = requireRecord(value);
  const task = requireString(input.task, "dryRun.task");
  const optional = (key: "agentId" | "environmentId" | "projectId"): string | undefined => {
    const item = input[key];
    if (item === undefined) return undefined;
    return requireString(item, `dryRun.${key}`);
  };
  const agentId = optional("agentId");
  const environmentId = optional("environmentId");
  const projectId = optional("projectId");
  return {
    task,
    ...(agentId === undefined ? {} : { agentId }),
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function requireEmpty(value: unknown): void {
  if (!isRecord(value) || Object.keys(value).length !== 0) throw new Error("This endpoint does not accept a payload.");
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Payload must be an object.");
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function success(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value };
}

function failure(code: string, message: string, details: Record<string, unknown> = {}): { ok: false; error: { code: string; message: string; details: Record<string, unknown> } } {
  return { ok: false, error: { code, message, details } };
}

function toFailure(error: unknown): ReturnType<typeof failure> {
  if (error instanceof ConfigValidationError) return failure("invalid-config", error.message, { issues: error.issues });
  if (error instanceof ConfigEditorError) return failure(error.code, error.message, error.details ?? {});
  return failure("bad-request", error instanceof Error ? error.message : String(error));
}
