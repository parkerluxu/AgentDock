import { randomUUID } from "node:crypto";
import type { AgentAdapter, AdapterTaskRequest } from "../adapter-contract/index.js";
import { isCapabilitySupported } from "../adapter-contract/index.js";
import { canTransitionRun, transitionRun } from "../core/state-machine.js";
import type { ExecutionContext, Run, RunEvent, RunRouteSnapshot, RunStatus } from "../core/types.js";
import { redactSensitiveValue } from "../core/redaction.js";
import { SqliteRunStore } from "../storage/sqlite-run-store.js";
import { EnvironmentSecretResolver, type SecretResolver } from "../secrets/resolver.js";

export interface ExecuteRunOptions {
  context: ExecutionContext;
  task: string;
  adapter: AgentAdapter;
  sessionId?: string;
  runtimeSessionId?: string;
  signal?: AbortSignal;
  runId?: string;
  sensitiveValues?: readonly string[];
  routing?: RunRouteSnapshot;
}

export class RunService {
  public constructor(private readonly store: SqliteRunStore, private readonly secretResolver: SecretResolver = new EnvironmentSecretResolver()) {}

  public get persistence(): SqliteRunStore {
    return this.store;
  }

  public async *execute(options: ExecuteRunOptions): AsyncIterable<{ run: Run; event: RunEvent }> {
    const existingSession = options.sessionId ? this.store.getSession(options.sessionId) : undefined;
    if (options.sessionId && !existingSession) throw new Error(`Session "${options.sessionId}" was not found.`);
    if (existingSession && existingSession.runtimeId !== options.context.runtime.id) {
      throw new Error(`Session "${existingSession.id}" belongs to Runtime "${existingSession.runtimeId}", not "${options.context.runtime.id}".`);
    }
    if (existingSession?.status !== undefined && existingSession.status !== "active") {
      throw new Error(`Session "${existingSession.id}" is archived and cannot accept a new Run.`);
    }
    let session = existingSession;
    if (!session) {
      const created = options.runtimeSessionId
        ? { supported: true, runtimeSessionId: options.runtimeSessionId }
        : isCapabilitySupported(options.adapter.manifest, "create_session") && options.adapter.createSession
        ? await options.adapter.createSession(options.signal)
        : { supported: false };
      session = this.store.createSession({
        id: randomUUID(),
        ...(options.context.project ? { projectId: options.context.project.id } : {}),
        runtimeId: options.context.runtime.id,
        resumable: created.supported && created.state !== "pending",
        ...(created.runtimeSessionId ? { runtimeSessionId: created.runtimeSessionId } : {}),
      });
    }
    const run = this.store.createRun({
      id: options.runId ?? randomUUID(),
      runtimeId: options.context.runtime.id,
      profileId: options.context.profile.id,
      ...(options.context.project ? { projectId: options.context.project.id } : {}),
      sessionId: session.id,
      task: options.task,
      snapshot: {
        runtime: options.context.runtime,
        profile: options.context.profile,
        policy: options.context.policy,
        ...(options.context.project ? { project: options.context.project } : {}),
        ...(options.routing ? { routing: options.routing } : {}),
        execution: {
          workingDirectory: options.context.workingDirectory,
          allowedEnvironmentKeys: options.context.allowedEnvironmentKeys,
          secretReferenceKeys: Object.keys(options.context.secretReferences).sort(),
        },
      },
      ownerPid: process.pid,
    });
    const sensitiveValues = options.sensitiveValues ?? [];
    const queuedEvent: RunEvent = {
      runId: run.id,
      sequence: 0,
      timestamp: run.createdAt,
      type: "status",
      payload: { status: "queued" },
    };
    this.store.appendEvent(queuedEvent);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
    let current = run;
    try {
      const runtimeSessionId = options.runtimeSessionId ?? session.runtimeSessionId;
      const request: AdapterTaskRequest = {
        runId: run.id,
        task: options.task,
        workingDirectory: options.context.workingDirectory,
        environment: { ...options.context.environment, ...this.secretResolver.resolve(options.context.secretReferences) },
        secretReferences: options.context.secretReferences,
        runtime: options.context.runtime,
        settings: options.context.profile.settings,
        ...(runtimeSessionId ? { runtimeSessionId } : {}),
        ...(runtimeSessionId ? { sessionMode: session.resumable || options.runtimeSessionId ? "resume" : "create" } : {}),
        signal: controller.signal,
      };
      yield { run: current, event: queuedEvent };
      let nextSequence = 1;
      for await (const adapterEvent of options.adapter.execute(request)) {
        const safeAdapterEvent = redactSensitiveValue(adapterEvent, sensitiveValues);
        const event: RunEvent = { ...safeAdapterEvent, sequence: nextSequence++ };
        this.store.appendEvent(event);
        const nextStatus = statusFromEvent(event, controller.signal.aborted);
        if (nextStatus && nextStatus !== current.status && canTransitionRun(current.status, nextStatus)) {
          transitionRun(current.status, nextStatus);
          const now = new Date().toISOString();
          current = this.store.updateRun(run.id, {
            status: nextStatus,
            ...(nextStatus === "running" ? { startedAt: now } : {}),
            ...(isTerminal(nextStatus) ? { finishedAt: now } : {}),
            ...(typeof event.payload.exitCode === "number" ? { exitCode: event.payload.exitCode } : {}),
            ...(nextStatus === "failed" ? { errorCode: typeof event.payload.errorCode === "string" ? event.payload.errorCode : "RUNTIME_FAILED" } : {}),
            ...(nextStatus === "timed_out" ? { errorCode: "RUNTIME_TIMED_OUT" } : {}),
            ...(nextStatus === "cancelled" ? { errorCode: "CANCELLED" } : {}),
          });
          if (request.sessionMode === "create" && nextStatus === "succeeded" && !session.resumable) {
            session = this.store.updateSession(session.id, { resumable: true });
          }
        } else {
          current = this.store.getRun(run.id) as Run;
        }
        yield { run: current, event };
      }
      if (!isTerminal(current.status)) {
        const finalStatus = controller.signal.aborted ? "cancelled" : "failed";
        current = this.store.updateRun(run.id, { status: finalStatus, finishedAt: new Date().toISOString(), errorCode: controller.signal.aborted ? "CANCELLED" : "NO_TERMINAL_EVENT" });
        const finalSequence = (this.store.listEvents(run.id).at(-1)?.sequence ?? -1) + 1;
        this.store.appendEvent({ runId: run.id, sequence: finalSequence, timestamp: new Date().toISOString(), type: controller.signal.aborted ? "status" : "error", payload: { status: finalStatus, errorCode: current.errorCode } });
      }
    } catch (error) {
      const nextStatus: RunStatus = controller.signal.aborted ? "cancelled" : "failed";
      if (canTransitionRun(current.status, nextStatus)) {
        current = this.store.updateRun(run.id, {
          status: nextStatus,
          finishedAt: new Date().toISOString(),
          errorCode: controller.signal.aborted ? "CANCELLED" : "ADAPTER_EXECUTION_ERROR",
        });
      }
      const event: RunEvent = {
        runId: run.id,
        sequence: (this.store.listEvents(run.id).at(-1)?.sequence ?? -1) + 1,
        timestamp: new Date().toISOString(),
        type: "error",
        payload: {
          status: controller.signal.aborted ? "cancelled" : "failed",
          errorCode: "ADAPTER_EXECUTION_ERROR",
          message: redactSensitiveValue(String(error), sensitiveValues),
        },
      };
      this.store.appendEvent(event);
      yield { run: current, event };
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}

function statusFromEvent(event: RunEvent, aborted: boolean): RunStatus | undefined {
  if (aborted) return "cancelled";
  if (event.type !== "status" && event.type !== "error") return undefined;
  const status = event.payload.status;
  if (status === "queued" || status === "running" || status === "succeeded" || status === "failed" || status === "cancelled" || status === "timed_out") return status;
  return event.type === "error" ? "failed" : undefined;
}

function isTerminal(status: RunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "timed_out";
}
