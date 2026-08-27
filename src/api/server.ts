import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { loadConfig } from "../config/load.js";
import type { AgentDockConfig } from "../config/schema.js";
import type { NetworkPolicy, Run, RunEvent, RunRouteSnapshot, RunStatus, RuntimeCapability } from "../core/types.js";
import { redactSensitiveValue, type RedactionOptions } from "../core/redaction.js";
import { AgentDockLogger, type Logger } from "../core/logger.js";
import { resolveExecutionContext } from "../policy/resolver.js";
import { configBaseDirectory, configDataPath, runtimeDescriptors } from "../runtime/configuration.js";
import { createBuiltinRuntimeRegistry, createConfiguredRuntimeRegistry, type RuntimeRegistry } from "../runtime/registry.js";
import { RunService } from "../runtime/run-service.js";
import { SqliteRunStore } from "../storage/sqlite-run-store.js";
import { resolveRoute, RouteResolutionError, type RuntimeHealthStatus } from "../runtime/router.js";
import { openApiDocument } from "./openapi.js";

const API_PREFIX = "/api/v1";
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 32;
const DEFAULT_MAX_CONCURRENT_RUNS = 4;
const MAX_SSE_BUFFERED_EVENTS = 256;
const MAX_RUN_LIST_LIMIT = 1_000;

export interface StartRunRequest {
  task: string;
  profileId?: string;
  projectId?: string;
  sessionId?: string;
  idempotencyKey?: string;
  requiredCapabilities?: RuntimeCapability[];
  network?: NetworkPolicy;
  filesystemWrite?: boolean;
}

export interface AgentDockApiServerOptions {
  config: AgentDockConfig;
  configPath: string;
  store?: SqliteRunStore;
  registry?: RuntimeRegistry;
  maxRequestBodyBytes?: number;
  requestTimeoutMs?: number;
  maxConcurrentRequests?: number;
  maxConcurrentRuns?: number;
  apiToken?: string;
  runtimeHealth?: Readonly<Record<string, RuntimeHealthStatus>>;
  logger?: Logger;
  redaction?: RedactionOptions;
}

export interface AgentDockApiServer {
  listen(port?: number, host?: "127.0.0.1" | "::1"): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

class ApiRequestError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface IdempotencyReservation {
  key: string;
  runId: string;
}

interface ActiveRun {
  controller: AbortController;
  completion?: Promise<void>;
}

interface PendingIdempotentStart {
  fingerprint: string;
  operation: Promise<{ run: Run; created: boolean }>;
}

type RunListener = (event: RunEvent) => void;

class LocalRunManager {
  private readonly runService: RunService;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly listeners = new Map<string, Set<RunListener>>();
  private readonly pendingControllers = new Set<AbortController>();
  private readonly startOperations = new Set<Promise<{ run: Run; created: boolean }>>();
  private readonly pendingIdempotentStarts = new Map<string, PendingIdempotentStart>();
  private pendingStarts = 0;
  private closing = false;

  public constructor(
    private readonly store: SqliteRunStore,
    private readonly config: AgentDockConfig,
    private readonly configPath: string,
    private readonly registry: RuntimeRegistry,
    private readonly maxConcurrentRuns: number,
    private readonly sensitiveValues: readonly string[],
    private readonly runtimeHealth: Readonly<Record<string, RuntimeHealthStatus>> | undefined,
    private readonly logger: Logger,
    private readonly redaction: RedactionOptions,
  ) {
    this.runService = new RunService(store);
  }

  public start(input: StartRunRequest): Promise<{ run: Run; created: boolean }> {
    if (this.closing) return Promise.reject(new ApiRequestError(503, "API_SHUTTING_DOWN", "The API server is shutting down."));
    const fingerprint = fingerprintStartRequest(input);
    if (input.idempotencyKey) {
      const pending = this.pendingIdempotentStarts.get(input.idempotencyKey);
      if (pending) {
        if (pending.fingerprint !== fingerprint) {
          return Promise.reject(new ApiRequestError(409, "IDEMPOTENCY_KEY_CONFLICT", "The idempotency key was already used for a different request."));
        }
        return pending.operation.then(({ run }) => ({ run, created: false }));
      }
    }
    const operation = this.startInternal(input);
    this.startOperations.add(operation);
    if (input.idempotencyKey) {
      this.pendingIdempotentStarts.set(input.idempotencyKey, { fingerprint, operation });
      operation.then(
        () => this.pendingIdempotentStarts.delete(input.idempotencyKey as string),
        () => this.pendingIdempotentStarts.delete(input.idempotencyKey as string),
      );
    }
    operation.then(
      () => this.startOperations.delete(operation),
      () => this.startOperations.delete(operation),
    );
    return operation;
  }

  private async startInternal(input: StartRunRequest): Promise<{ run: Run; created: boolean }> {
    const fingerprint = fingerprintStartRequest(input);
    const reservation = input.idempotencyKey ? this.reserveIdempotency(input.idempotencyKey, fingerprint) : undefined;
    if (reservation?.status === "existing") {
      const existingRun = this.store.getRun(reservation.runId);
      if (existingRun) return { run: existingRun, created: false };
      throw new ApiRequestError(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "An equivalent request is already being started.");
    }
    if (reservation?.status === "in_progress") throw new ApiRequestError(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "An equivalent request is already being started.");
    if (reservation?.status === "conflict") throw new ApiRequestError(409, "IDEMPOTENCY_KEY_CONFLICT", "The idempotency key was already used for a different request.");

    if (this.activeRuns.size + this.pendingStarts >= this.maxConcurrentRuns) {
      if (reservation) this.store.releaseIdempotencyKey(reservation.key, reservation.runId);
      throw new ApiRequestError(429, "RUN_CONCURRENCY_LIMIT", "The maximum number of active Runs has been reached.");
    }
    this.pendingStarts += 1;
    const controller = new AbortController();
    this.pendingControllers.add(controller);

    let startPending = true;
    try {
      const routing = resolveRoute(this.config, {
        ...(input.profileId ? { profileId: input.profileId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        requirements: {
          ...(input.requiredCapabilities ? { requiredCapabilities: input.requiredCapabilities } : {}),
          ...(input.network ? { network: input.network } : {}),
          ...(input.filesystemWrite !== undefined ? { filesystemWrite: input.filesystemWrite } : {}),
        },
        ...(this.runtimeHealth ? { runtimeHealth: this.runtimeHealth } : {}),
      });
      const context = resolveExecutionContext({
        config: this.config,
        baseDirectory: configBaseDirectory(this.configPath),
        profileId: routing.profileId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      });
      if (input.sessionId) this.validateSession(input.sessionId, context.runtime.id);

      const runId = reservation?.runId ?? randomUUID();
      const iterator = this.runService.execute({
        context,
        task: input.task,
        adapter: this.registry.create(context.runtime),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        runId,
        signal: controller.signal,
        sensitiveValues: this.sensitiveValues,
        redaction: this.redaction,
        routing: routing as RunRouteSnapshot,
      })[Symbol.asyncIterator]();

      const first = await iterator.next();
      if (first.done || !first.value) throw new Error("Run did not produce its queued event.");
      this.pendingStarts -= 1;
      startPending = false;
      this.publish(first.value.event);
      const active: ActiveRun = { controller };
      this.activeRuns.set(runId, active);
      active.completion = this.consume(runId, iterator);
      return { run: first.value.run, created: true };
    } catch (error) {
      if (startPending) this.pendingStarts -= 1;
      if (reservation) this.store.releaseIdempotencyKey(reservation.key, reservation.runId);
      throw error;
    } finally {
      this.pendingControllers.delete(controller);
    }
  }

  private reserveIdempotency(key: string, requestHash: string): IdempotencyReservation & { status: "created" | "existing" | "in_progress" | "conflict" } {
    const runId = randomUUID();
    const result = this.store.reserveIdempotencyKey(key, requestHash, runId);
    if (result.status === "created") return { status: "created", key, runId };
    if (result.status === "existing") return { status: "existing", key, runId: result.runId };
    if (result.status === "in_progress") return { status: "in_progress", key, runId: result.runId };
    return { status: "conflict", key, runId };
  }

  public cancel(runId: string): "accepted" | "not_found" | "not_active" | "terminal" {
    const run = this.store.getRun(runId);
    if (!run) return "not_found";
    if (isTerminal(run.status)) return "terminal";
    const active = this.activeRuns.get(runId);
    if (!active) return "not_active";
    active.controller.abort();
    return "accepted";
  }

  public subscribe(runId: string, listener: RunListener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<RunListener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  public async shutdown(): Promise<void> {
    this.closing = true;
    for (const controller of this.pendingControllers) controller.abort();
    for (const { controller } of this.activeRuns.values()) controller.abort();
    await Promise.allSettled([...this.startOperations]);
    await Promise.allSettled([...this.activeRuns.values()].map(({ completion }) => completion ?? Promise.resolve()));
  }

  private async consume(runId: string, iterator: AsyncIterator<{ run: Run; event: RunEvent }>): Promise<void> {
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done || !next.value) return;
        this.publish(next.value.event);
      }
    } catch {
      this.logger.error("adapter_execution_failed", { runId });
      this.recoverUnexpectedFailure(runId);
    } finally {
      this.activeRuns.delete(runId);
      const run = this.store.getRun(runId);
      if (run) this.logger.info("run_finished", { runId, status: run.status });
    }
  }

  private recoverUnexpectedFailure(runId: string): void {
    try {
      const run = this.store.getRun(runId);
      if (!run || isTerminal(run.status)) return;
      const now = new Date().toISOString();
      const failed = this.store.updateRun(runId, { status: "failed", finishedAt: now, errorCode: "ADAPTER_EXECUTION_ERROR" });
      const sequence = (this.store.listEvents(runId).at(-1)?.sequence ?? -1) + 1;
      const event: RunEvent = {
        runId,
        sequence,
        timestamp: now,
        type: "error",
        payload: { status: failed.status, errorCode: failed.errorCode },
      };
      this.store.appendEvent(event);
      this.publish(event);
    } catch {
      // A second persistence failure cannot be reported through the same store.
    }
  }

  private publish(event: RunEvent): void {
    for (const listener of this.listeners.get(event.runId) ?? []) listener(event);
  }

  private validateSession(sessionId: string, runtimeId: string): void {
    const session = this.store.getSession(sessionId);
    if (!session) throw new ApiRequestError(404, "SESSION_NOT_FOUND", `Session "${sessionId}" was not found.`);
    if (session.runtimeId !== runtimeId) {
      throw new ApiRequestError(409, "SESSION_RUNTIME_MISMATCH", `Session "${sessionId}" belongs to Runtime "${session.runtimeId}", not "${runtimeId}".`);
    }
    if (session.status !== "active") throw new ApiRequestError(409, "SESSION_ARCHIVED", `Session "${sessionId}" is archived and cannot accept a new Run.`);
  }
}

export function createAgentDockApiServer(options: AgentDockApiServerOptions): AgentDockApiServer {
  const ownsStore = !options.store;
  const store = options.store ?? new SqliteRunStore(configDataPath(options.config, options.configPath), options.config.storage);
  store.recoverStaleRuns();
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxConcurrentRequests = options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS;
  const maxConcurrentRuns = options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
  validatePositiveInteger(requestTimeoutMs, "requestTimeoutMs");
  validatePositiveInteger(maxConcurrentRequests, "maxConcurrentRequests");
  validatePositiveInteger(maxConcurrentRuns, "maxConcurrentRuns");
  const apiToken = resolveApiToken(options, configDataPath(options.config, options.configPath));
  const redaction = options.redaction ?? options.config.redaction;
  const logger = options.logger ?? new AgentDockLogger({ level: options.config.logging.level, redaction });
  const manager = new LocalRunManager(
    store,
    options.config,
    options.configPath,
    options.registry ?? createBuiltinRuntimeRegistry(),
    maxConcurrentRuns,
    apiToken ? [apiToken] : [],
    options.runtimeHealth,
    logger,
    redaction,
  );
  const streams = new Set<ServerResponse>();
  const maxRequestBodyBytes = options.maxRequestBodyBytes ?? MAX_REQUEST_BODY_BYTES;
  validatePositiveInteger(maxRequestBodyBytes, "maxRequestBodyBytes");
  let server: Server | undefined;
  let closeOperation: Promise<void> | undefined;
  let inFlightRequests = 0;

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let holdsRequestSlot = false;
    let longLived = false;
    try {
      if (inFlightRequests >= maxConcurrentRequests) {
        writeJson(response, 429, { error: { code: "REQUEST_CONCURRENCY_LIMIT", message: "The maximum number of concurrent API requests has been reached." } }, apiToken ? [apiToken] : [], redaction);
        return;
      }
      inFlightRequests += 1;
      holdsRequestSlot = true;
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      authenticate(request, apiToken);

      if (request.method === "GET" && path === `${API_PREFIX}/openapi.json`) {
        writeJson(response, 200, openApiDocument, apiToken ? [apiToken] : [], redaction);
        return;
      }
      if (request.method === "GET" && path === `${API_PREFIX}/health`) {
        writeJson(response, 200, { healthy: true, apiVersion: "v1" }, apiToken ? [apiToken] : [], redaction);
        return;
      }
      if (request.method === "GET" && path === `${API_PREFIX}/runtimes`) {
        writeJson(response, 200, { runtimes: runtimeDescriptors(options.config) }, apiToken ? [apiToken] : [], redaction);
        return;
      }
      if (request.method === "GET" && path === `${API_PREFIX}/sessions`) {
        writeJson(response, 200, { sessions: store.listSessions() }, apiToken ? [apiToken] : [], redaction);
        return;
      }
      if (request.method === "GET" && path === `${API_PREFIX}/runs`) {
        const status = parseRunStatus(url.searchParams.get("status"));
        const projectId = url.searchParams.get("projectId") ?? undefined;
        const limit = parseOptionalInteger(url.searchParams.get("limit"), "limit", 1, MAX_RUN_LIST_LIMIT);
        writeJson(response, 200, {
          runs: store.listRuns({
            ...(status ? { status } : {}),
            ...(projectId ? { projectId } : {}),
            ...(limit ? { limit } : {}),
          }),
        }, apiToken ? [apiToken] : [], redaction);
        return;
      }
      if (request.method === "POST" && path === `${API_PREFIX}/runs`) {
        requireJsonContentType(request);
        const input = parseStartRunRequest(await readJsonBody(request, maxRequestBodyBytes, requestTimeoutMs));
        const headerKey = request.headers["idempotency-key"];
        const idempotencyKey = typeof headerKey === "string" ? parseIdempotencyKey(headerKey) : undefined;
        if (input.idempotencyKey && idempotencyKey && input.idempotencyKey !== idempotencyKey) {
          throw new ApiRequestError(400, "IDEMPOTENCY_KEY_CONFLICT", "The Idempotency-Key header must match body.idempotencyKey when both are provided.");
        }
        const result = await manager.start({ ...input, ...(idempotencyKey ?? input.idempotencyKey ? { idempotencyKey: idempotencyKey ?? input.idempotencyKey } : {}) });
        writeJson(response, result.created ? 202 : 200, {
          run: result.run,
          created: result.created,
          eventsUrl: `${API_PREFIX}/runs/${result.run.id}/events`,
        }, apiToken ? [apiToken] : [], redaction);
        return;
      }

      const runEvents = /^\/api\/v1\/runs\/([^/]+)\/events$/.exec(path);
      if (request.method === "GET" && runEvents?.[1]) {
        const runId = decodeURIComponent(runEvents[1]);
        const run = store.getRun(runId);
        if (!run) throw new ApiRequestError(404, "RUN_NOT_FOUND", `Run "${runId}" was not found.`);
        const after = parseOptionalInteger(url.searchParams.get("after"), "after", -1) ?? -1;
        const events = store.listEvents(runId).filter((event) => event.sequence > after);
        if (wantsSse(request, url)) {
          if (events.length > MAX_SSE_BUFFERED_EVENTS) throw new ApiRequestError(413, "SSE_REPLAY_TOO_LARGE", "The requested SSE replay is too large; reconnect with a later cursor.");
          longLived = writeSse(response, runId, events, run.status, store, manager, streams, apiToken ? [apiToken] : [], redaction, () => {
            if (holdsRequestSlot) {
              holdsRequestSlot = false;
              inFlightRequests -= 1;
            }
          });
        } else {
          writeJson(response, 200, { events }, apiToken ? [apiToken] : [], redaction);
        }
        return;
      }

      const runRoute = /^\/api\/v1\/runs\/([^/]+)$/.exec(path);
      if (runRoute?.[1]) {
        const runId = decodeURIComponent(runRoute[1]);
        if (request.method === "GET") {
          const run = store.getRun(runId);
          if (!run) throw new ApiRequestError(404, "RUN_NOT_FOUND", `Run "${runId}" was not found.`);
          writeJson(response, 200, { run }, apiToken ? [apiToken] : [], redaction);
          return;
        }
        if (request.method === "POST" && url.searchParams.get("action") === "cancel") {
          writeCancelResult(response, manager.cancel(runId), runId, apiToken ? [apiToken] : [], redaction);
          return;
        }
      }

      const cancelRoute = /^\/api\/v1\/runs\/([^/]+)\/cancel$/.exec(path);
      if (request.method === "POST" && cancelRoute?.[1]) {
        writeCancelResult(response, manager.cancel(decodeURIComponent(cancelRoute[1])), decodeURIComponent(cancelRoute[1]), apiToken ? [apiToken] : [], redaction);
        return;
      }

      throw new ApiRequestError(404, "NOT_FOUND", `No API route matches ${request.method ?? "UNKNOWN"} ${path}.`);
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === "AUTH_REQUIRED" || apiError.code === "INVALID_AUTH") response.setHeader("www-authenticate", "Bearer");
      // Keep query strings out of logs; clients occasionally put bearer-like values there while debugging.
      logger.warn("api_request_failed", { method: request.method, path: (request.url ?? "/").split("?", 1)[0], code: apiError.code, statusCode: apiError.statusCode });
      writeJson(response, apiError.statusCode, {
        error: {
          code: apiError.code,
          message: apiError.message,
          ...(apiError.details ? { details: apiError.details } : {}),
        },
      }, apiToken ? [apiToken] : [], redaction);
    } finally {
      if (holdsRequestSlot && !longLived) inFlightRequests -= 1;
    }
  };

  return {
    async listen(port = 0, host = "127.0.0.1"): Promise<{ host: string; port: number }> {
      if (closeOperation) throw new Error("The API server is closed.");
      if (server) throw new Error("The API server is already listening.");
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("The API port must be an integer between 0 and 65535.");
      if (host !== "127.0.0.1" && host !== "::1") throw new Error("The local API may listen only on 127.0.0.1 or ::1.");
      const current = createServer((request, response) => void handler(request, response));
      current.requestTimeout = requestTimeoutMs;
      current.headersTimeout = Math.max(requestTimeoutMs, 1_000);
      current.keepAliveTimeout = requestTimeoutMs;
      server = current;
      try {
        await new Promise<void>((resolve, reject) => {
          current.once("error", reject);
          current.listen(port, host, () => {
            current.removeListener("error", reject);
            resolve();
          });
        });
      } catch (error) {
        if (server === current) server = undefined;
        try { current.close(); } catch { /* The listen attempt may have failed before binding. */ }
        throw error;
      }
      const address = current.address() as AddressInfo;
      return { host, port: address.port };
    },

    async close(): Promise<void> {
      if (closeOperation) return closeOperation;
      closeOperation = (async (): Promise<void> => {
        await manager.shutdown();
        for (const stream of streams) stream.end();
        streams.clear();
        if (server) {
          const current = server;
          server = undefined;
          await new Promise<void>((resolve, reject) => current.close((error) => error ? reject(error) : resolve()));
        }
        if (ownsStore) store.close();
      })();
      return closeOperation;
    },
  };
}

export async function createAgentDockApiServerFromConfig(configPath: string): Promise<AgentDockApiServer> {
  const config = await loadConfig(configPath);
  return createAgentDockApiServer({ config, configPath, registry: await createConfiguredRuntimeRegistry(config, configPath) });
}

function parseStartRunRequest(body: unknown): Omit<StartRunRequest, "idempotencyKey"> & { idempotencyKey?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiRequestError(400, "INVALID_REQUEST", "The request body must be a JSON object.");
  const input = body as Record<string, unknown>;
  const task = requiredString(input.task, "task");
  const profileId = optionalString(input.profileId, "profileId");
  const projectId = optionalString(input.projectId, "projectId");
  const sessionId = optionalString(input.sessionId, "sessionId");
  const idempotencyKey = input.idempotencyKey === undefined ? undefined : parseIdempotencyKey(requiredString(input.idempotencyKey, "idempotencyKey"));
  const requiredCapabilities = parseCapabilities(input.requiredCapabilities);
  const network = input.network === undefined ? undefined : parseNetwork(input.network);
  const filesystemWrite = input.filesystemWrite === undefined ? undefined : parseBoolean(input.filesystemWrite, "filesystemWrite");
  return {
    task,
    ...(profileId ? { profileId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(requiredCapabilities ? { requiredCapabilities } : {}),
    ...(network ? { network } : {}),
    ...(filesystemWrite !== undefined ? { filesystemWrite } : {}),
  };
}

function parseCapabilities(value: unknown): RuntimeCapability[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new ApiRequestError(400, "INVALID_REQUEST", "\"requiredCapabilities\" must be an array of strings.");
  const supported: RuntimeCapability[] = ["execute", "stream_events", "cancel", "create_session", "resume_session", "healthcheck"];
  const capabilities = value.map((item) => String(item)) as RuntimeCapability[];
  if (capabilities.some((item) => !supported.includes(item))) throw new ApiRequestError(400, "INVALID_REQUEST", "\"requiredCapabilities\" contains an unsupported capability.");
  return [...new Set(capabilities)];
}

function parseNetwork(value: unknown): NetworkPolicy {
  if (value !== "allow" && value !== "deny") throw new ApiRequestError(400, "INVALID_REQUEST", "\"network\" must be \"allow\" or \"deny\".");
  return value;
}

function parseBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new ApiRequestError(400, "INVALID_REQUEST", `\"${name}\" must be a boolean.`);
  return value;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiRequestError(400, "INVALID_REQUEST", `"${name}" must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function parseIdempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length === 0 || key.length > 128) throw new ApiRequestError(400, "INVALID_IDEMPOTENCY_KEY", "The idempotency key must contain 1 to 128 characters.");
  return key;
}

function parseRunStatus(value: string | null): RunStatus | undefined {
  if (value === null) return undefined;
  if (value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled" || value === "timed_out") return value;
  throw new ApiRequestError(400, "INVALID_QUERY", `"status" is not a valid Run status: ${value}.`);
}

function parseOptionalInteger(value: string | null, name: string, minimum: number, maximum?: number): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || (maximum !== undefined && parsed > maximum)) {
    throw new ApiRequestError(400, "INVALID_QUERY", maximum === undefined
      ? `"${name}" must be an integer greater than or equal to ${minimum}.`
      : `"${name}" must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

async function readJsonBody(request: IncomingMessage, maximumBytes: number, timeoutMs: number): Promise<unknown> {
  const contentLength = request.headers["content-length"];
  if (typeof contentLength === "string" && Number.isInteger(Number(contentLength)) && Number(contentLength) > maximumBytes) {
    throw new ApiRequestError(413, "REQUEST_TOO_LARGE", `The request body exceeds ${maximumBytes} bytes.`);
  }
  let size = 0;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      request.destroy();
      reject(new ApiRequestError(408, "REQUEST_TIMEOUT", "The request body was not received before the timeout."));
    }, timeoutMs);
    const cleanup = (): void => clearTimeout(timeout);
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maximumBytes) {
        cleanup();
        request.destroy();
        reject(new ApiRequestError(413, "REQUEST_TOO_LARGE", `The request body exceeds ${maximumBytes} bytes.`));
        return;
      }
      chunks.push(buffer);
    });
    request.once("end", () => {
      cleanup();
      resolve();
    });
    request.once("aborted", () => {
      cleanup();
      reject(new ApiRequestError(408, "REQUEST_ABORTED", "The client aborted the request."));
    });
    request.once("error", (error) => {
      cleanup();
      reject(new ApiRequestError(400, "REQUEST_READ_ERROR", "The request body could not be read."));
    });
  });
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiRequestError(400, "INVALID_JSON", "The request body must contain valid JSON.");
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown, sensitiveValues: readonly string[] = [], redaction: RedactionOptions = {}): void {
  if (response.writableEnded) return;
  const encoded = JSON.stringify(redactSensitiveValue(body, sensitiveValues, redaction));
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
  });
  response.end(encoded);
}

function wantsSse(request: IncomingMessage, url: URL): boolean {
  return url.searchParams.get("stream") === "sse" || request.headers.accept?.includes("text/event-stream") === true;
}

function writeSse(
  response: ServerResponse,
  runId: string,
  events: RunEvent[],
  status: RunStatus,
  store: SqliteRunStore,
  manager: LocalRunManager,
  streams: Set<ServerResponse>,
  sensitiveValues: readonly string[],
  redaction: RedactionOptions,
  releaseRequestSlot: () => void,
): boolean {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.write(": agentdock event stream\n\n");
  const queue = events.map((event) => redactSensitiveValue(event, sensitiveValues, redaction));
  let ended = false;
  let unsubscribe = (): void => undefined;
  let lastKnownSequence = events.at(-1)?.sequence ?? -1;
  const cleanup = (): void => {
    if (ended) return;
    ended = true;
    streams.delete(response);
    unsubscribe();
    releaseRequestSlot();
  };
  let terminal = isTerminal(status);
  let waitingForDrain = false;
  const flush = (): void => {
    if (ended || waitingForDrain) return;
    while (queue.length > 0) {
      const event = queue.shift() as RunEvent;
      if (!writeSseEvent(response, event)) {
        waitingForDrain = true;
        response.once("drain", () => {
          waitingForDrain = false;
          flush();
        });
        return;
      }
    }
    if (terminal && !response.writableEnded) {
      cleanup();
      response.end();
    }
  };
  if (!terminal) {
    streams.add(response);
    unsubscribe = manager.subscribe(runId, (event) => {
      if (ended) return;
      if (event.sequence <= lastKnownSequence) return;
      lastKnownSequence = event.sequence;
      queue.push(redactSensitiveValue(event, sensitiveValues, redaction));
      if (queue.length > MAX_SSE_BUFFERED_EVENTS) {
        cleanup();
        response.end();
        return;
      }
      const current = store.getRun(runId);
      if (current && isTerminal(current.status)) {
        terminal = true;
      }
      flush();
    });
    const current = store.getRun(runId);
    if (current && isTerminal(current.status)) {
      terminal = true;
      for (const event of store.listEvents(runId)) {
        if (event.sequence <= lastKnownSequence) continue;
        queue.push(redactSensitiveValue(event, sensitiveValues, redaction));
        lastKnownSequence = event.sequence;
      }
    }
  }
  response.once("close", cleanup);
  flush();
  return !terminal;
}

function writeSseEvent(response: ServerResponse, event: RunEvent): boolean {
  if (response.writableEnded) return true;
  return response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function writeCancelResult(response: ServerResponse, result: ReturnType<LocalRunManager["cancel"]>, runId: string, sensitiveValues: readonly string[], redaction: RedactionOptions): void {
  if (result === "accepted") {
    writeJson(response, 202, { runId, cancellationRequested: true }, sensitiveValues, redaction);
    return;
  }
  if (result === "not_found") throw new ApiRequestError(404, "RUN_NOT_FOUND", `Run "${runId}" was not found.`);
  if (result === "terminal") throw new ApiRequestError(409, "RUN_NOT_CANCELLABLE", `Run "${runId}" is already in a terminal state.`);
  throw new ApiRequestError(409, "RUN_NOT_ACTIVE", `Run "${runId}" is not managed by this API process.`);
}

function toApiError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  if (error instanceof RouteResolutionError) return new ApiRequestError(409, error.code, error.message, { candidates: error.candidates });
  return new ApiRequestError(500, "INTERNAL_ERROR", "The API request could not be completed.");
}

function fingerprintStartRequest(input: StartRunRequest): string {
  const { idempotencyKey: _idempotencyKey, ...request } = input;
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`The API ${name} must be a positive integer.`);
}

function resolveApiToken(options: AgentDockApiServerOptions, databasePath: string): string {
  const configured = options.apiToken ?? process.env.AGENTDOCK_API_TOKEN;
  if (configured !== undefined) {
    if (configured.trim().length < 16) throw new Error("The API token must contain at least 16 characters.");
    return configured.trim();
  }
  const tokenPath = join(dirname(databasePath), "api-token");
  try {
    const token = readFileSync(tokenPath, "utf8").trim();
    if (token.length >= 16) return token;
  } catch {
    // Create the local token below.
  }
  const token = randomBytes(32).toString("base64url");
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(tokenPath, 0o600); } catch { /* Windows may not support POSIX modes. */ }
  return token;
}

function authenticate(request: IncomingMessage, expectedToken: string): void {
  const header = request.headers.authorization;
  if (typeof header !== "string") throw new ApiRequestError(401, "AUTH_REQUIRED", "Authentication is required.");
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match?.[1]) throw new ApiRequestError(401, "INVALID_AUTH", "The authorization header is invalid.");
  const actual = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApiRequestError(401, "INVALID_AUTH", "The authorization token is invalid.");
}

function requireJsonContentType(request: IncomingMessage): void {
  const rawContentType = request.headers["content-type"];
  const contentType = rawContentType ? rawContentType.split(";", 1)[0]?.trim().toLowerCase() : undefined;
  if (contentType !== "application/json") throw new ApiRequestError(415, "UNSUPPORTED_MEDIA_TYPE", "The request content type must be application/json.");
}

function isTerminal(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "timed_out";
}
