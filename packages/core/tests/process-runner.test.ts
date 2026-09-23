import { execPath } from "node:process";
import { describe, expect, it } from "vitest";
import { collectProcessOutput, ProcessRunner } from "../src/runtime/process-runner.js";

describe("ProcessRunner", () => {
  it("captures stdout, stderr and exit status", async () => {
    const runner = new ProcessRunner();
    const execution = runner.execute({
      command: execPath,
      args: ["-e", "console.log('hello:' + process.env.AGENTDOCK_TEST + ':secret=' + (process.env.AGENTDOCK_UNALLOWED ?? 'missing')); console.error('warning')"],
      cwd: process.cwd(),
      env: { AGENTDOCK_TEST: "1" },
    });
    const result = await collectProcessOutput(execution);
    expect(result.stdout).toContain("hello:1:secret=missing");
    expect(result.stderr).toContain("warning");
    expect(result.exit.code).toBe(0);
  });

  it("terminates a process after the configured timeout", async () => {
    const runner = new ProcessRunner();
    const execution = runner.execute({
      command: execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 25,
    });
    const result = await collectProcessOutput(execution);
    expect(result.exit.timedOut).toBe(true);
  });

  it("cancels a running process through AbortSignal", async () => {
    const controller = new AbortController();
    const runner = new ProcessRunner();
    const execution = runner.execute({
      command: execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      cwd: process.cwd(),
      env: {},
      signal: controller.signal,
    });
    controller.abort();
    const result = await collectProcessOutput(execution);
    expect(result.exit.timedOut).toBeUndefined();
    expect(result.exit.code).not.toBe(0);
  });

  it("preserves a non-zero process exit code", async () => {
    const runner = new ProcessRunner();
    const execution = runner.execute({
      command: execPath,
      args: ["-e", "process.exitCode = 7"],
      cwd: process.cwd(),
      env: {},
    });
    const result = await collectProcessOutput(execution);
    expect(result.exit.code).toBe(7);
    expect(result.exit.timedOut).toBeUndefined();
  });

  it.skipIf(process.platform !== "win32")("preserves quoted arguments when launching a Windows .cmd shim", async () => {
    const runner = new ProcessRunner();
    const execution = runner.execute({
      command: "npm",
      // npm config prints every requested key. A key containing a space makes
      // this an assertion about the shim's argument quoting, without relying
      // on npm exec's package-resolution behavior across npm versions.
      args: ["--workspaces=false", "config", "get", "user-agent", "hello world"],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
      timeoutMs: 15_000,
    });
    const result = await collectProcessOutput(execution);
    expect(result.exit.code).toBe(0);
    expect(result.stdout).toContain("hello world=undefined");
  });
});
