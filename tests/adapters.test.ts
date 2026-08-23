import { describe, expect, it } from "vitest";
import type { AdapterTaskRequest } from "../src/adapter-contract/index.js";
import type { RuntimeDescriptor } from "../src/core/types.js";
import { ClaudeCodeAdapter, CodexAdapter } from "../src/runtime/adapters.js";
import { ProcessRunner } from "../src/runtime/process-runner.js";

const runtime = (id: string, binary: string): RuntimeDescriptor => ({
  id,
  adapter: id,
  binary,
  args: [],
  enabled: true,
  capabilities: ["execute"],
});

const request = (runtimeDescriptor: RuntimeDescriptor): AdapterTaskRequest => ({
  runId: "run-1",
  task: "inspect repository",
  workingDirectory: process.cwd(),
  environment: {},
  secretReferences: {},
  runtime: runtimeDescriptor,
  settings: { sandbox: "read-only", permissionMode: "plan", outputFormat: "stream-json" },
  runtimeSessionId: "session-1",
  signal: new AbortController().signal,
});

class InspectableClaudeAdapter extends ClaudeCodeAdapter {
  public args(value: AdapterTaskRequest): string[] {
    return this.buildArgs(value);
  }
}

class InspectableCodexAdapter extends CodexAdapter {
  public args(value: AdapterTaskRequest): string[] {
    return this.buildArgs(value);
  }
}

describe("built-in adapter command mapping", () => {
  it("maps Claude Code print, stream and resume flags", () => {
    const args = new InspectableClaudeAdapter(runtime("claude-code", "claude"), new ProcessRunner()).args(request(runtime("claude-code", "claude")));
    expect(args).toEqual(["--print", "--output-format", "stream-json", "--verbose", "--permission-mode", "plan", "--resume", "session-1", "inspect repository"]);
  });

  it("creates a Claude Code session with session-id instead of resume", () => {
    const value = { ...request(runtime("claude-code", "claude")), sessionMode: "create" as const };
    const args = new InspectableClaudeAdapter(runtime("claude-code", "claude"), new ProcessRunner()).args(value);
    expect(args).toEqual(["--print", "--output-format", "stream-json", "--verbose", "--permission-mode", "plan", "--session-id", "session-1", "inspect repository"]);
  });

  it("marks a freshly allocated Claude ID as pending until a Run creates it", async () => {
    await expect(new ClaudeCodeAdapter(runtime("claude-code", "claude"), new ProcessRunner()).createSession()).resolves.toMatchObject({ supported: true, state: "pending" });
  });

  it("puts Codex resume after exec and before the prompt", () => {
    const args = new InspectableCodexAdapter(runtime("codex", "codex"), new ProcessRunner()).args(request(runtime("codex", "codex")));
    expect(args).toEqual(["exec", "resume", "--json", "--sandbox", "read-only", "session-1", "inspect repository"]);
  });

  it("adds Codex trust bypass only when the Profile explicitly enables it", () => {
    const value = { ...request(runtime("codex", "codex")), settings: { sandbox: "read-only", skipGitRepoCheck: true } };
    const args = new InspectableCodexAdapter(runtime("codex", "codex"), new ProcessRunner()).args(value);
    expect(args).toEqual(["exec", "resume", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "session-1", "inspect repository"]);
  });
});
