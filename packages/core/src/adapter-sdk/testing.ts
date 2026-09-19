import type { AgentAdapter, AdapterHealth, AdapterTaskRequest } from "../adapter-contract/index.js";
import { isCapabilitySupported, validateAdapterManifest } from "../adapter-contract/index.js";
import type { RuntimeDescriptor, RunEvent } from "../core/types.js";

export interface AdapterContractTestOptions {
  runtime: RuntimeDescriptor;
  runId?: string;
  task?: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  settings?: Record<string, unknown>;
}

export interface AdapterContractReport {
  health: AdapterHealth;
  events: RunEvent[];
  cancelCompleted: boolean;
}

/** Execute the deterministic checks shared by built-in and third-party Adapter tests. */
export async function assertAdapterContract(
  adapter: AgentAdapter,
  options: AdapterContractTestOptions,
): Promise<AdapterContractReport> {
  validateAdapterManifest(adapter.manifest);
  if (isCapabilitySupported(adapter.manifest, "create_session") && !adapter.createSession) {
    throw new Error("Manifest declares create_session but the Adapter does not implement createSession().");
  }
  if (isCapabilitySupported(adapter.manifest, "resume_session") && !adapter.resumeSession) {
    throw new Error("Manifest declares resume_session but the Adapter does not implement resumeSession().");
  }

  const health = await adapter.healthCheck();
  if (!health.healthy) throw new Error(`Adapter health check failed: ${health.message ?? "unknown error"}`);

  const runId = options.runId ?? "adapter-contract-run";
  const controller = new AbortController();
  const request: AdapterTaskRequest = {
    runId,
    task: options.task ?? "adapter contract smoke task",
    workingDirectory: options.workingDirectory ?? process.cwd(),
    environment: options.environment ?? {},
    secretReferences: {},
    runtime: options.runtime,
    settings: options.settings ?? {},
    signal: controller.signal,
  };
  const events: RunEvent[] = [];
  for await (const event of adapter.execute(request)) events.push(event);
  validateEvents(events, runId);
  await adapter.cancel(runId);
  return { health, events, cancelCompleted: true };
}

function validateEvents(events: RunEvent[], runId: string): void {
  if (events.length === 0) throw new Error("Adapter execution produced no events.");
  let previousSequence = -1;
  for (const event of events) {
    if (event.runId !== runId) throw new Error(`Adapter event belongs to Run "${event.runId}", expected "${runId}".`);
    if (!Number.isInteger(event.sequence) || event.sequence <= previousSequence) throw new Error("Adapter event sequences must be strictly increasing.");
    previousSequence = event.sequence;
  }
  const last = events.at(-1);
  const status = last?.payload.status;
  if (last?.type !== "status" && last?.type !== "error") throw new Error("Adapter execution must end with a status or error event.");
  if (status !== "succeeded" && status !== "failed" && status !== "cancelled" && status !== "timed_out") {
    throw new Error("Adapter execution must end with a terminal status.");
  }
}
