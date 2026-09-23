import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export interface AgentDockGatewayConfig {
  /** URL of a running loopback AgentDock API. */
  apiBaseUrl?: string;
  /** Environment variable containing the AgentDock API bearer token. Never persisted by this plugin. */
  apiTokenEnv?: string;
  /** Optional default AgentDock agent for newly bound DSH sessions. */
  defaultAgentId?: string;
  /** Durable DSH-session to AgentDock-session binding registry. */
  bindingStorePath?: string;
}

export interface AgentDockSessionBinding {
  dshSessionId: string;
  agentId: string;
  projectId?: string;
  agentDockSessionId?: string;
  updatedAt: string;
}

export interface AgentDockCatalog {
  agents: Array<{ id: string; engineId: string; environmentId: string; enabled: boolean }>;
  projects: Array<{ id: string; agentIds?: string[]; defaultAgentId?: string }>;
}

const MODEL_AGENT_PREFIX = "agent:";

/** A DSH model id which selects an AgentDock Agent rather than a manually bound route. */
export function modelIdForAgent(agentId: string): string {
  return `${MODEL_AGENT_PREFIX}${encodeURIComponent(agentId)}`;
}

export function agentIdFromModelId(modelId: string): string | undefined {
  if (!modelId.startsWith(MODEL_AGENT_PREFIX)) return undefined;
  const encoded = modelId.slice(MODEL_AGENT_PREFIX.length);
  if (!encoded) return undefined;
  try {
    const agentId = decodeURIComponent(encoded);
    return isId(agentId) ? agentId : undefined;
  } catch {
    return undefined;
  }
}

export interface AgentDockRunEvent {
  runId: string;
  sequence: number;
  timestamp: string;
  type: "status" | "message" | "tool_call" | "tool_result" | "error";
  payload: Record<string, unknown>;
}

export class AgentDockGatewayError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AgentDockGatewayError";
  }
}

/**
 * Local HTTP bridge used by the DSH adapter. It deliberately speaks AgentDock's
 * public API rather than importing a second control-plane runtime into DSH.
 */
export class AgentDockGateway {
  private readonly apiBaseUrl: string;
  private readonly apiTokenEnv: string;
  private readonly defaultAgentId: string | undefined;
  private readonly bindingStorePath: string;
  private bindings = new Map<string, AgentDockSessionBinding>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly sessionCreates = new Map<string, Promise<AgentDockSessionBinding>>();

  public constructor(config: AgentDockGatewayConfig = {}) {
    this.apiBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl ?? "http://127.0.0.1:4177");
    this.apiTokenEnv = config.apiTokenEnv?.trim() || "AGENTDOCK_API_TOKEN";
    this.defaultAgentId = config.defaultAgentId?.trim() || undefined;
    this.bindingStorePath = resolveBindingStore(config.bindingStorePath);
  }

  public async catalog(signal?: AbortSignal): Promise<AgentDockCatalog> {
    const [agents, projects] = await Promise.all([
      this.request<{ agents: AgentDockCatalog["agents"] }>("/agents", withSignal({}, signal)),
      this.request<{ projects: AgentDockCatalog["projects"] }>("/projects", withSignal({}, signal)),
    ]);
    return { agents: agents.agents, projects: projects.projects };
  }

  public async binding(dshSessionId: string): Promise<AgentDockSessionBinding | undefined> {
    await this.load();
    return this.bindings.get(dshSessionId);
  }

  public async bind(input: Omit<AgentDockSessionBinding, "agentDockSessionId" | "updatedAt">): Promise<AgentDockSessionBinding> {
    if (!isId(input.dshSessionId)) throw new AgentDockGatewayError("INVALID_SESSION", "DSH session id must be a non-empty string.");
    if (!isId(input.agentId)) throw new AgentDockGatewayError("INVALID_AGENT", "AgentDock agent id must be a non-empty string.");
    const catalog = await this.catalog();
    const agent = catalog.agents.find((item) => item.id === input.agentId);
    if (!agent) throw new AgentDockGatewayError("AGENT_NOT_FOUND", `AgentDock agent "${input.agentId}" was not found.`);
    if (!agent.enabled) throw new AgentDockGatewayError("AGENT_DISABLED", `AgentDock agent "${input.agentId}" is disabled.`);
    if (input.projectId && !catalog.projects.some((item) => item.id === input.projectId)) {
      throw new AgentDockGatewayError("PROJECT_NOT_FOUND", `AgentDock project "${input.projectId}" was not found.`);
    }
    await this.load();
    const current = this.bindings.get(input.dshSessionId);
    const next: AgentDockSessionBinding = {
      dshSessionId: input.dshSessionId,
      agentId: input.agentId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      // Changing route must never resume an old backend session under another agent.
      ...(current?.agentId === input.agentId && current.projectId === input.projectId && current.agentDockSessionId !== undefined
        ? { agentDockSessionId: current.agentDockSessionId }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    this.bindings.set(next.dshSessionId, next);
    await this.persist();
    return next;
  }

  public async unbind(dshSessionId: string): Promise<boolean> {
    await this.load();
    const deleted = this.bindings.delete(dshSessionId);
    if (deleted) await this.persist();
    return deleted;
  }

  /** Selects a route from a DSH model choice, without ever reusing another Agent's native session. */
  public async selectAgentForDshSession(dshSessionId: string, agentId: string, signal?: AbortSignal): Promise<AgentDockSessionBinding> {
    const catalog = await this.catalog(signal);
    const agent = catalog.agents.find((item) => item.id === agentId);
    if (!agent) throw new AgentDockGatewayError("AGENT_NOT_FOUND", `AgentDock agent "${agentId}" was not found.`);
    if (!agent.enabled) throw new AgentDockGatewayError("AGENT_DISABLED", `AgentDock agent "${agentId}" is disabled.`);
    const current = await this.binding(dshSessionId);
    if (current?.agentId === agentId) return current;
    const projectId = preferredProjectId(catalog.projects, agentId);
    return this.bind({ dshSessionId, agentId, ...(projectId === undefined ? {} : { projectId }) });
  }

  /** Resolve or create the AgentDock-side session that gives a DSH chat continuity. */
  public async ensureAgentDockSession(dshSessionId: string, signal?: AbortSignal): Promise<AgentDockSessionBinding> {
    const existing = this.sessionCreates.get(dshSessionId);
    if (existing) return existing;
    const operation = this.ensureAgentDockSessionInternal(dshSessionId, signal);
    this.sessionCreates.set(dshSessionId, operation);
    try { return await operation; } finally { this.sessionCreates.delete(dshSessionId); }
  }

  private async ensureAgentDockSessionInternal(dshSessionId: string, signal?: AbortSignal): Promise<AgentDockSessionBinding> {
    let binding = await this.binding(dshSessionId);
    if (!binding && this.defaultAgentId) binding = await this.bind({ dshSessionId, agentId: this.defaultAgentId });
    if (!binding) throw new AgentDockGatewayError("SESSION_UNBOUND", "This DSH session is not bound to an AgentDock agent. Select one in Settings → AgentDock.");
    if (binding.agentDockSessionId) return binding;
    const created = await this.request<{ session: { id: string } }>("/sessions", {
      method: "POST",
      body: { agentId: binding.agentId, ...(binding.projectId === undefined ? {} : { projectId: binding.projectId }) },
      ...withSignal({}, signal),
    });
    binding = { ...binding, agentDockSessionId: created.session.id, updatedAt: new Date().toISOString() };
    this.bindings.set(dshSessionId, binding);
    await this.persist();
    return binding;
  }

  /** Streams one DSH user turn through the matching AgentDock agent. */
  public async *invoke(dshSessionId: string, task: string, signal?: AbortSignal, selectedAgentId?: string): AsyncIterable<AgentDockRunEvent> {
    if (!task.trim()) throw new AgentDockGatewayError("EMPTY_TASK", "AgentDock cannot invoke an empty task.");
    if (selectedAgentId !== undefined) await this.selectAgentForDshSession(dshSessionId, selectedAgentId, signal);
    const binding = await this.ensureAgentDockSession(dshSessionId, signal);
    const response = await this.fetch(`/agents/${encodeURIComponent(binding.agentId)}/invoke`, {
      method: "POST",
      headers: { accept: "text/event-stream", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({
        task,
        sessionId: binding.agentDockSessionId,
        ...(binding.projectId === undefined ? {} : { projectId: binding.projectId }),
      }),
      ...withSignal({}, signal),
    });
    if (!response.ok) throw await this.responseError(response);
    if (!response.body) throw new AgentDockGatewayError("EMPTY_STREAM", "AgentDock returned no event stream.");
    for await (const event of parseSse(response.body)) {
      if (event.type === "accepted") continue;
      if (isRunEvent(event.data)) yield event.data;
    }
  }

  private async request<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const response = await this.fetch(path, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? {} : { "content-type": "application/json" },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...withSignal({}, options.signal),
    });
    if (!response.ok) throw await this.responseError(response);
    return await response.json() as T;
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const token = process.env[this.apiTokenEnv]?.trim();
    if (!token) throw new AgentDockGatewayError("TOKEN_MISSING", `Set ${this.apiTokenEnv} to the AgentDock API token before starting DSH.`);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    try {
      return await globalThis.fetch(`${this.apiBaseUrl}/api/v1${path}`, { ...init, headers });
    } catch (error) {
      if (init.signal?.aborted) throw new AgentDockGatewayError("ABORTED", "AgentDock request was cancelled.");
      throw new AgentDockGatewayError("UNREACHABLE", `Could not reach AgentDock at ${this.apiBaseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async responseError(response: Response): Promise<AgentDockGatewayError> {
    let body: { error?: { code?: string; message?: string } } | undefined;
    try { body = await response.json() as typeof body; } catch { /* Keep the stable HTTP fallback. */ }
    return new AgentDockGatewayError(body?.error?.code ?? "API_ERROR", body?.error?.message ?? `AgentDock API request failed (${response.status}).`, response.status);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.bindingStorePath, "utf8")) as unknown;
      if (!Array.isArray(raw)) throw new Error("binding file is not an array");
      for (const item of raw) {
        if (!isBinding(item)) continue;
        this.bindings.set(item.dshSessionId, item);
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
      if (code !== "ENOENT") throw new AgentDockGatewayError("BINDING_STORE_INVALID", `Could not read DSH session bindings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async persist(): Promise<void> {
    const previous = this.writeChain;
    let release!: () => void;
    this.writeChain = new Promise<void>((resolveWrite) => { release = resolveWrite; });
    await previous;
    try {
      await mkdir(dirname(this.bindingStorePath), { recursive: true });
      const temporary = `${this.bindingStorePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify([...this.bindings.values()], null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.bindingStorePath);
    } finally { release(); }
  }
}

function resolveBindingStore(value: string | undefined): string {
  const selected = value?.trim() || ".agentdock/dsh-session-bindings.json";
  return isAbsolute(selected) ? selected : resolve(process.cwd(), selected);
}

function withSignal<T extends object>(value: T, signal: AbortSignal | undefined): T & { signal?: AbortSignal } {
  return signal ? { ...value, signal } : value;
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("AgentDock apiBaseUrl must use http or https.");
  return url.toString().replace(/\/$/u, "");
}

function isId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

function preferredProjectId(projects: AgentDockCatalog["projects"], agentId: string): string | undefined {
  const defaultMatches = projects.filter((project) => project.defaultAgentId === agentId);
  if (defaultMatches.length === 1) return defaultMatches[0]?.id;
  const allowedMatches = projects.filter((project) => project.agentIds?.includes(agentId));
  return allowedMatches.length === 1 ? allowedMatches[0]?.id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function isBinding(value: unknown): value is AgentDockSessionBinding {
  return isRecord(value) && isId(value.dshSessionId) && isId(value.agentId) && typeof value.updatedAt === "string"
    && (value.projectId === undefined || isId(value.projectId)) && (value.agentDockSessionId === undefined || isId(value.agentDockSessionId));
}

function isRunEvent(value: unknown): value is AgentDockRunEvent {
  return isRecord(value) && isId(value.runId) && Number.isInteger(value.sequence) && typeof value.timestamp === "string"
    && (value.type === "status" || value.type === "message" || value.type === "tool_call" || value.type === "tool_result" || value.type === "error")
    && isRecord(value.payload);
}

async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncIterable<{ type: string; data: unknown }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "message";
  let data: string[] = [];
  const flush = (): { type: string; data: unknown } | undefined => {
    if (data.length === 0) return undefined;
    const joined = data.join("\n");
    data = [];
    try { return { type: eventType, data: JSON.parse(joined) as unknown }; } catch { return { type: eventType, data: joined }; }
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "") {
          const event = flush();
          if (event) yield event;
          eventType = "message";
        } else if (line.startsWith("event:")) eventType = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      for (const line of buffer.split(/\r?\n/u)) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
    }
    const event = flush();
    if (event) yield event;
  } finally { reader.releaseLock(); }
}
