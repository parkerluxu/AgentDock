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
});
