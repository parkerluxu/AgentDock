import { randomUUID } from "node:crypto";
import type { AgentAdapter, AdapterHealth, AdapterManifest, AdapterSessionReference, AdapterTaskRequest } from "../adapter-contract/index.js";
import { defineAdapterManifest } from "../adapter-sdk/index.js";
import type { RuntimeDescriptor, RunEvent } from "../core/types.js";
import { collectProcessOutput, ProcessRunner } from "./process-runner.js";
import { normalizeRuntimeEvent, parseJsonLines } from "./event-parser.js";

const API_VERSION = "v1" as const;

abstract class CliAdapter implements AgentAdapter {
  public abstract readonly manifest: AdapterManifest;
  protected readonly processes = new Map<string, ReturnType<ProcessRunner["execute"]>>();

  public constructor(protected readonly runtime: RuntimeDescriptor, protected readonly runner: ProcessRunner) {}

  public async healthCheck(signal?: AbortSignal): Promise<AdapterHealth> {
    try {
      const execution = this.runner.execute({
        command: this.binary(),
        args: ["--version"],
        cwd: process.cwd(),
        env: {},
        ...(signal ? { signal } : {}),
      });
      const result = await collectProcessOutput(execution);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const version = extractVersion(output);
      return {
        healthy: result.exit.code === 0,
        runtime: {
          ...this.runtime,
          ...(version ? { version } : {}),
        },
        ...(result.exit.code === 0 ? {} : { message: output || `Exited with code ${String(result.exit.code)}.` }),
      };
    } catch (error) {
      return { healthy: false, runtime: this.runtime, message: String(error) };
    }
  }

  public async *execute(request: AdapterTaskRequest): AsyncIterable<RunEvent> {
    const execution = this.runner.execute({
      command: this.binary(),
      args: this.buildArgs(request),
      cwd: request.workingDirectory,
      env: request.environment,
      ...(typeof request.settings.timeoutMs === "number" ? { timeoutMs: request.settings.timeoutMs } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    this.processes.set(request.runId, execution);
    yield event(request.runId, 0, "status", { status: "running" });
    let sequence = 1;
    let stdoutBuffer = "";
    let stderr = "";
    try {
      for await (const item of execution.output) {
        if (item.type === "stdout") {
          stdoutBuffer += item.data;
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() ?? "";
          for (const parsed of parseJsonLines(lines.join("\n"), request.runId, sequence)) {
            sequence = parsed.sequence + 1;
            yield parsed;
          }
        } else if (item.type === "stderr") {
          stderr += item.data;
        } else {
          if (stdoutBuffer.trim()) {
            for (const parsed of parseJsonLines(stdoutBuffer, request.runId, sequence)) {
              sequence = parsed.sequence + 1;
              yield parsed;
            }
          }
          if (item.type !== "exit") continue;
          if (item.timedOut) yield event(request.runId, sequence++, "error", { status: "timed_out", exitCode: item.code, signal: item.signal, stderr: redact(stderr) });
          else if (item.code === 0) yield event(request.runId, sequence++, "status", { status: "succeeded", exitCode: item.code });
          else yield event(request.runId, sequence++, "error", { status: "failed", exitCode: item.code, signal: item.signal, stderr: redact(stderr) });
        }
      }
    } finally {
      this.processes.delete(request.runId);
    }
  }

  public async cancel(runId: string): Promise<void> {
    await this.processes.get(runId)?.cancel();
  }

  protected abstract binary(): string;
  protected abstract buildArgs(request: AdapterTaskRequest): string[];
}

export class ClaudeCodeAdapter extends CliAdapter {
  public readonly manifest: AdapterManifest = defineAdapterManifest({
    name: "claude-code",
    version: "0.1.0",
    entry: "builtin:claude-code",
    agentDockApi: API_VERSION,
    runtime: { id: "claude-code", versionRange: ">=2.1.0" },
    capabilities: ["execute", "stream_events", "cancel", "create_session", "resume_session", "healthcheck"],
    requiredPermissions: ["filesystem.read"],
  });

  protected binary(): string {
    return this.runtime.binary ?? "claude";
  }

  public async createSession(): Promise<AdapterSessionReference> {
    // Claude creates the actual conversation on the first --session-id Run;
    // allocating a UUID alone does not make it valid for --resume yet.
    return { supported: true, runtimeSessionId: randomUUID(), state: "pending" };
  }

  public async resumeSession(runtimeSessionId: string): Promise<AdapterSessionReference> {
    return { supported: true, runtimeSessionId };
  }

  protected buildArgs(request: AdapterTaskRequest): string[] {
    const settings = request.settings;
    const outputFormat = String(settings.outputFormat ?? "stream-json");
    const args = [...this.runtime.args, "--print", "--output-format", outputFormat];
    // Claude CLI requires verbose mode for streamed JSON output in print mode.
    if (outputFormat === "stream-json") args.push("--verbose");
    if (typeof settings.permissionMode === "string") args.push("--permission-mode", settings.permissionMode);
    if (request.runtimeSessionId) {
      args.push(request.sessionMode === "create" ? "--session-id" : "--resume", request.runtimeSessionId);
    }
    args.push(request.task);
    return args;
  }
}

export class CodexAdapter extends CliAdapter {
  public readonly manifest: AdapterManifest = defineAdapterManifest({
    name: "codex",
    version: "0.1.0",
    entry: "builtin:codex",
    agentDockApi: API_VERSION,
    runtime: { id: "codex", versionRange: ">=0.147.0" },
    capabilities: ["execute", "stream_events", "cancel", "resume_session", "healthcheck"],
    requiredPermissions: ["filesystem.read"],
  });

  protected binary(): string {
    return this.runtime.binary ?? "codex";
  }

  public async resumeSession(runtimeSessionId: string): Promise<AdapterSessionReference> {
    return { supported: true, runtimeSessionId, state: "active" };
  }

  protected buildArgs(request: AdapterTaskRequest): string[] {
    const settings = request.settings;
    const args = [...this.runtime.args, "exec", ...(request.runtimeSessionId ? ["resume"] : []), "--json"];
    if (typeof settings.sandbox === "string") args.push("--sandbox", settings.sandbox);
    if (typeof settings.approvalPolicy === "string") args.push("--ask-for-approval", settings.approvalPolicy);
    if (settings.skipGitRepoCheck === true) args.push("--skip-git-repo-check");
    if (request.runtimeSessionId) args.push(request.runtimeSessionId);
    args.push(request.task);
    return args;
  }
}

function event(runId: string, sequence: number, type: RunEvent["type"], payload: Record<string, unknown>): RunEvent {
  return { runId, sequence, timestamp: new Date().toISOString(), type, payload };
}

function extractVersion(output: string): string | undefined {
  return output.match(/\d+\.\d+(?:\.\d+)?(?:[-+][^\s]+)?/)?.[0];
}

function redact(value: string): string {
  return value.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s]+/gi, "$1=[REDACTED]");
}
