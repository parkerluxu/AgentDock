import { randomUUID } from "node:crypto";
import type { NetworkPolicy, Run, RunEvent, RuntimeCapability, RunStatus } from "../core/types.js";

export interface AgentDockClientOptions {
  /** API base URL, for example http://127.0.0.1:4177/api/v1. */
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  maxReconnects?: number;
  reconnectDelayMs?: number;
}

export interface AgentRunOptions {
  task: string;
  projectId?: string;
  sessionId?: string;
  idempotencyKey?: string;
  requiredCapabilities?: RuntimeCapability[];
  network?: NetworkPolicy;
  filesystemWrite?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentInvocationEvent) => void | Promise<void>;
  maxReconnects?: number;
  reconnectDelayMs?: number;
}

export interface AgentAcceptedEvent {
  type: "accepted";
  payload: {
    runId: string;
    created: boolean;
    eventsUrl: string;
  };
}

export type AgentInvocationEvent = AgentAcceptedEvent | RunEvent;

export interface AgentRunResult {
  runId: string;
  run: Run;
  accepted: AgentAcceptedEvent;
  events: RunEvent[];
}

export class AgentDockClientError extends Error {
  public constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentDockClientError";
  }
}

export class AgentDockClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly maxReconnects: number;
  private readonly reconnectDelayMs: number;

  public constructor(options: AgentDockClientOptions) {
    if (options.baseUrl.trim().length === 0) throw new Error("The AgentDock API base URL must not be empty.");
    if (options.token.trim().length === 0) throw new Error("The AgentDock API token must not be empty.");
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.token = options.token;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxReconnects = options.maxReconnects ?? 5;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 250;
    validateNonNegativeInteger(this.maxReconnects, "maxReconnects");
    validateNonNegativeInteger(this.reconnectDelayMs, "reconnectDelayMs");
  }

  public agent(agentId: string): AgentClient {
    if (agentId.trim().length === 0) throw new Error("The Agent id must not be empty.");
    return new AgentClient(this, agentId);
  }

  public async run(agentId: string, options: AgentRunOptions): Promise<AgentRunResult> {
    return this.agent(agentId).run(options);
  }

  public async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    return this.fetcher(this.url(path), { ...init, headers });
  }

  public url(path: string): string {
    return `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
  }

  public get defaultMaxReconnects(): number {
    return this.maxReconnects;
  }

  public get defaultReconnectDelayMs(): number {
    return this.reconnectDelayMs;
  }
}

export class AgentClient {
  public constructor(
    private readonly client: AgentDockClient,
    public readonly id: string,
  ) {}

  public async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const task = options.task.trim();
    if (task.length === 0) throw new Error("The Agent task must not be empty.");
    const maxReconnects = options.maxReconnects ?? this.clientMaxReconnects();
    const reconnectDelayMs = options.reconnectDelayMs ?? this.clientReconnectDelayMs();
    validateNonNegativeInteger(maxReconnects, "maxReconnects");
    validateNonNegativeInteger(reconnectDelayMs, "reconnectDelayMs");

    const idempotencyKey = options.idempotencyKey ?? randomUUID();
    const requestBody = {
      task,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.requiredCapabilities ? { requiredCapabilities: options.requiredCapabilities } : {}),
      ...(options.network ? { network: options.network } : {}),
      ...(options.filesystemWrite !== undefined ? { filesystemWrite: options.filesystemWrite } : {}),
    };
    const events: RunEvent[] = [];
    let accepted: AgentAcceptedEvent | undefined;
    let runId: string | undefined;
    let lastSequence = -1;
    let terminal = false;
    let reconnects = 0;

    while (!terminal) {
      try {
        const response = runId
          ? await this.client.request(`runs/${encodeURIComponent(runId)}/events?after=${lastSequence}`, {
            headers: { accept: "text/event-stream" },
            ...(options.signal ? { signal: options.signal } : {}),
          })
          : await this.client.request(`agents/${encodeURIComponent(this.id)}/invoke`, {
            method: "POST",
            headers: { accept: "text/event-stream", "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify(requestBody),
            ...(options.signal ? { signal: options.signal } : {}),
          });
        await assertResponse(response);
        if (!response.body) throw new AgentDockClientError("The AgentDock response did not contain an SSE body.");

        for await (const frame of readSse(response.body)) {
          if (frame.event === "accepted") {
            if (accepted) continue;
            const payload = parseAcceptedPayload(frame.data);
            accepted = { type: "accepted", payload };
            runId = payload.runId;
            await notify(options.onEvent, accepted);
            continue;
          }
          const event = parseRunEvent(frame.data);
          if (runId === undefined) runId = event.runId;
          if (event.runId !== runId || event.sequence <= lastSequence) continue;
          lastSequence = event.sequence;
          events.push(event);
          await notify(options.onEvent, event);
          if (isTerminalStatus(event.payload.status)) terminal = true;
        }

        if (terminal) break;
        if (!runId) throw new AgentDockClientError("The AgentDock SSE stream ended before it sent an accepted event.");
        const current = await this.getRun(runId, options.signal);
        if (isTerminalStatus(current.status)) {
          terminal = true;
          break;
        }
        throw new AgentDockClientError("The AgentDock SSE stream ended before the Run reached a terminal state.");
      } catch (error) {
        if (isCallbackError(error) || options.signal?.aborted) throw unwrapCallbackError(error);
        if (!shouldRetry(error, reconnects, maxReconnects)) throw error;
        reconnects += 1;
        await delay(reconnectDelayMs, options.signal);
      }
    }

    if (!runId || !accepted) throw new AgentDockClientError("The AgentDock invocation completed without an accepted event.");
    const run = await this.getRun(runId, options.signal);
    return { runId, run, accepted, events };
  }

  private clientMaxReconnects(): number {
    return this.client.defaultMaxReconnects;
  }

  private clientReconnectDelayMs(): number {
    return this.client.defaultReconnectDelayMs;
  }

  private async getRun(runId: string, signal?: AbortSignal): Promise<Run> {
    const response = await this.client.request(`runs/${encodeURIComponent(runId)}`, signal ? { signal } : {});
    await assertResponse(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AgentDockClientError("The AgentDock Run response was not valid JSON.");
    }
    if (!isRecord(body) || !isRecord(body.run) || typeof body.run.id !== "string" || typeof body.run.status !== "string") {
      throw new AgentDockClientError("The AgentDock Run response had an invalid shape.");
    }
    return body.run as unknown as Run;
  }
}

interface SseFrame {
  event: string;
  data: string;
}

async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      for (const frame of takeSseFrames(buffer, next.done)) {
        buffer = frame.remaining;
        if (frame.value) yield frame.value;
      }
      if (next.done) break;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* The stream may already be errored. */ }
  }
}

function takeSseFrames(input: string, flush: boolean): Array<{ value: SseFrame | undefined; remaining: string }> {
  const frames: Array<{ value: SseFrame | undefined; remaining: string }> = [];
  let remaining = input;
  while (true) {
    const match = /\r?\n\r?\n/u.exec(remaining);
    if (!match || match.index === undefined) break;
    const end = match.index + match[0].length;
    frames.push({ value: parseSseFrame(remaining.slice(0, match.index)), remaining: remaining.slice(end) });
    remaining = remaining.slice(end);
  }
  if (flush && remaining.trim().length > 0) frames.push({ value: parseSseFrame(remaining), remaining: "" });
  if (frames.length === 0) return [{ value: undefined, remaining: input }];
  frames[frames.length - 1]!.remaining = remaining;
  return frames;
}

function parseSseFrame(frame: string): SseFrame | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.replace(/\r/gu, "").split("\n")) {
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /u, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length > 0 ? { event, data: data.join("\n") } : undefined;
}

function parseAcceptedPayload(value: string): AgentAcceptedEvent["payload"] {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { throw new AgentDockClientError("The accepted SSE event was not valid JSON."); }
  if (!isRecord(parsed) || typeof parsed.runId !== "string" || typeof parsed.created !== "boolean" || typeof parsed.eventsUrl !== "string") {
    throw new AgentDockClientError("The accepted SSE event had an invalid shape.");
  }
  return { runId: parsed.runId, created: parsed.created, eventsUrl: parsed.eventsUrl };
}

function parseRunEvent(value: string): RunEvent {
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { throw new AgentDockClientError("A Run SSE event was not valid JSON."); }
  const sequence = isRecord(parsed) ? parsed.sequence : undefined;
  if (!isRecord(parsed) || typeof parsed.runId !== "string" || !Number.isInteger(sequence) || (sequence as number) < 0 || typeof parsed.type !== "string" || !isRecord(parsed.payload)) {
    throw new AgentDockClientError("A Run SSE event had an invalid shape.");
  }
  return parsed as unknown as RunEvent;
}

async function assertResponse(response: Response): Promise<void> {
  if (response.ok) return;
  let details: unknown;
  try { details = await response.clone().json(); } catch { /* Use the status when the body is not JSON. */ }
  const message = isRecord(details) && isRecord(details.error) && typeof details.error.message === "string" ? details.error.message : `AgentDock returned HTTP ${response.status}.`;
  throw new AgentDockClientError(message, response.status, details);
}

async function notify(callback: AgentRunOptions["onEvent"], event: AgentInvocationEvent): Promise<void> {
  if (!callback) return;
  try { await callback(event); } catch (error) { throw new CallbackError(error); }
}

function shouldRetry(error: unknown, attempts: number, maxAttempts: number): boolean {
  if (attempts >= maxAttempts) return false;
  if (error instanceof AgentDockClientError) return error.statusCode === undefined || error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500;
  return true;
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds === 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("The Agent invocation was aborted."));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal) setTimeout(() => signal.removeEventListener("abort", abort), milliseconds);
  });
}

function isTerminalStatus(value: unknown): value is RunStatus {
  return value === "succeeded" || value === "failed" || value === "cancelled" || value === "timed_out";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`The ${name} option must be a non-negative integer.`);
}

class CallbackError extends Error {
  public constructor(public override readonly cause: unknown) {
    super("The Agent invocation event callback failed.");
    this.name = "CallbackError";
  }
}

function isCallbackError(error: unknown): error is CallbackError {
  return error instanceof CallbackError;
}

function unwrapCallbackError(error: unknown): unknown {
  return error instanceof CallbackError ? error.cause : error;
}
