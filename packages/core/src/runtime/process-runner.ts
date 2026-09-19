import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, extname } from "node:path";

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ProcessOutput =
  | { type: "stdout" | "stderr"; data: string }
  | { type: "exit"; code: number | null; signal?: string; timedOut?: boolean };

export type ProcessExit = Extract<ProcessOutput, { type: "exit" }>;

export interface ProcessExecution {
  readonly pid: number | undefined;
  readonly output: AsyncIterable<ProcessOutput>;
  cancel(): Promise<void>;
}

interface QueueItem<T> {
  value?: T;
  error?: Error;
  done?: boolean;
}

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(item: QueueItem<T>) => void> = [];
  private completed = false;

  public push(value: T): void {
    if (this.completed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value });
    else this.values.push(value);
  }

  public finish(): void {
    if (this.completed) return;
    this.completed = true;
    while (this.waiters.length > 0) this.waiters.shift()?.({ done: true });
  }

  public fail(error: Error): void {
    if (this.completed) return;
    this.completed = true;
    while (this.waiters.length > 0) this.waiters.shift()?.({ error });
  }

  public async next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) return { done: false, value: this.values.shift() as T };
    if (this.completed) return { done: true, value: undefined };
    const item = await new Promise<QueueItem<T>>((resolve) => this.waiters.push(resolve));
    if (item.error) throw item.error;
    if (item.done) return { done: true, value: undefined };
    return { done: false, value: item.value as T };
  }

  public async *iterate(): AsyncIterable<T> {
    while (true) {
      const result = await this.next();
      if (result.done) return;
      yield result.value;
    }
  }
}

export class ProcessRunner {
  private readonly processes = new Map<number, ChildProcess>();

  public execute(request: ProcessRequest): ProcessExecution {
    const queue = new AsyncQueue<ProcessOutput>();
    const executable = resolveExecutable(request.command);
    const args = executable.prefixArgs
      ? [...executable.prefixArgs, [executable.originalCommand ?? request.command, ...request.args].map(quoteWindowsArg).join(" ")]
      : request.args;
    const child = spawn(executable.command, args, {
      cwd: request.cwd,
      // The caller has already applied the Policy environment allowlist.
      env: request.env,
      shell: executable.shell,
      // The final argument to cmd.exe is an already-quoted command line.
      // Let Windows receive it verbatim; otherwise Node escapes the embedded
      // quotes and cmd.exe forwards them as literal characters to .cmd shims.
      windowsVerbatimArguments: executable.prefixArgs !== undefined,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid !== undefined) this.processes.set(child.pid, child);
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    child.stdout?.on("data", (data: Buffer | string) => queue.push({ type: "stdout", data: String(data) }));
    child.stderr?.on("data", (data: Buffer | string) => queue.push({ type: "stderr", data: String(data) }));
    child.on("error", (error) => queue.fail(error));
    child.on("close", (code, signal) => {
      if (child.pid !== undefined) this.processes.delete(child.pid);
      if (timeout) clearTimeout(timeout);
      queue.push({ type: "exit", code, ...(signal ? { signal } : {}), ...(timedOut ? { timedOut: true } : {}) });
      queue.finish();
    });

    const cancel = async (): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null || child.killed) return;
      child.kill();
    };
    if (request.signal) {
      if (request.signal.aborted) void cancel();
      else request.signal.addEventListener("abort", () => void cancel(), { once: true });
    }
    if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        void cancel();
      }, request.timeoutMs);
    }

    return { pid: child.pid, output: queue.iterate(), cancel };
  }

  public async cancel(pid: number): Promise<void> {
    const child = this.processes.get(pid);
    if (child && !child.killed) child.kill();
  }
}

interface ResolvedExecutable {
  command: string;
  shell: boolean;
  prefixArgs?: string[];
  originalCommand?: string;
}

function resolveExecutable(command: string): ResolvedExecutable {
  if (process.platform !== "win32" || isAbsolute(command) || extname(command)) {
    return { command, shell: false };
  }

  // Windows installs npm CLIs as .cmd shims. Resolve the shim explicitly so
  // Node does not depend on shell parsing for ordinary executable paths.
  // Prefer native binaries; npm-installed CLIs usually require their .cmd shim.
  for (const suffix of [".cmd", ".exe", ".bat"]) {
    try {
      const output = execFileSync("where.exe", [`${command}${suffix}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const candidate = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
      if (candidate && existsSync(candidate)) {
        if (suffix === ".cmd" || suffix === ".bat") {
          return {
            command: process.env.ComSpec ?? "cmd.exe",
            shell: false,
            prefixArgs: ["/d", "/s", "/c"],
            originalCommand: candidate,
          };
        }
        return { command: candidate, shell: false };
      }
    } catch {
      // Try the next executable suffix.
    }
  }
  return { command, shell: false };
}

function quoteWindowsArg(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export async function collectProcessOutput(execution: ProcessExecution): Promise<{ stdout: string; stderr: string; exit: ProcessExit }> {
  let stdout = "";
  let stderr = "";
  let exit: ProcessExit | undefined;
  for await (const item of execution.output) {
    if (item.type === "stdout") stdout += item.data;
    else if (item.type === "stderr") stderr += item.data;
    else if (item.type === "exit") exit = item;
  }
  if (!exit) throw new Error("Process ended without an exit event.");
  return { stdout, stderr, exit };
}
