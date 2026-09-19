import type { AgentAdapter, AdapterHealth, AdapterManifest, AdapterTaskRequest } from "../adapter-contract/index.js";
import { createMessageEvent, createStatusEvent, defineAdapterManifest } from "../adapter-sdk/index.js";
import type { RunEvent } from "../core/types.js";

/** Deterministic local Adapter for SDK development, examples and integration tests. */
export class EchoAdapter implements AgentAdapter {
  public readonly manifest: AdapterManifest = defineAdapterManifest({
    name: "echo",
    version: "0.1.0",
    entry: "builtin:echo",
    agentDockApi: "v1",
    runtime: { id: "echo", versionRange: "*" },
    capabilities: ["execute", "stream_events", "cancel", "healthcheck"],
    requiredPermissions: [],
  });

  private readonly controllers = new Map<string, AbortController>();

  public constructor(private readonly runtime: AdapterTaskRequest["runtime"]) {}

  public async healthCheck(signal?: AbortSignal): Promise<AdapterHealth> {
    if (signal?.aborted) return { healthy: false, runtime: this.runtime, message: "Health check was cancelled." };
    return { healthy: true, runtime: this.runtime };
  }

  public async *execute(request: AdapterTaskRequest): AsyncIterable<RunEvent> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    if (request.signal.aborted) controller.abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    this.controllers.set(request.runId, controller);
    try {
      yield createStatusEvent(request.runId, 0, "running");
      await Promise.resolve();
      if (controller.signal.aborted) {
        yield createStatusEvent(request.runId, 1, "cancelled");
        return;
      }
      yield createMessageEvent(request.runId, 1, request.task, { adapter: this.manifest.name, echoed: true });
      await Promise.resolve();
      if (controller.signal.aborted) yield createStatusEvent(request.runId, 2, "cancelled");
      else yield createStatusEvent(request.runId, 2, "succeeded", { exitCode: 0 });
    } finally {
      request.signal.removeEventListener("abort", abort);
      this.controllers.delete(request.runId);
    }
  }

  public async cancel(runId: string): Promise<void> {
    this.controllers.get(runId)?.abort();
  }
}
