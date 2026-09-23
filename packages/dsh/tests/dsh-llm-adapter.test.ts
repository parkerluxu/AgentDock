import { describe, expect, it } from "vitest";
import { AgentDockLlmAdapter } from "../src/llm-adapter.js";
import { modelIdForAgent } from "../src/gateway.js";

describe("AgentDock DSH LLM adapter", () => {
  it("converts an AgentDock message stream into DSH text chunks for the bound session", async () => {
    const calls: Array<{ sessionId: string; task: string }> = [];
    const gateway = {
      async *invoke(sessionId: string, task: string) {
        calls.push({ sessionId, task });
        yield { runId: "run-1", sequence: 0, timestamp: "2026-01-01T00:00:00.000Z", type: "message" as const, payload: { text: "hello " } };
        yield { runId: "run-1", sequence: 1, timestamp: "2026-01-01T00:00:01.000Z", type: "message" as const, payload: { text: "world" } };
        yield { runId: "run-1", sequence: 2, timestamp: "2026-01-01T00:00:02.000Z", type: "status" as const, payload: { status: "succeeded" } };
      },
    };
    const adapter = new AgentDockLlmAdapter(gateway as never);
    const chunks = [];
    for await (const chunk of adapter.stream({
      provider: "agentdock", model: "bound", sessionId: "dsh-1" as never,
      messages: [{ role: "user", content: [{ type: "text", text: "Say hello" }] }] as never,
    })) chunks.push(chunk);
    expect(calls).toEqual([{ sessionId: "dsh-1", task: "Say hello" }]);
    expect(chunks).toEqual([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "hello " },
      { type: "text-delta", index: 0, text: "world" },
      { type: "block-end", index: 0, block: { type: "text", text: "hello world" } },
      { type: "finish", reason: { kind: "stop" } },
    ]);
  });

  it("reads a completed Codex agent message from a legacy status event", async () => {
    const gateway = {
      async *invoke() {
        yield { runId: "run-1", sequence: 0, timestamp: "2026-01-01T00:00:00.000Z", type: "status" as const,
          payload: { type: "item.completed", item: { type: "agent_message", text: "Codex reply" } } };
        yield { runId: "run-1", sequence: 1, timestamp: "2026-01-01T00:00:01.000Z", type: "status" as const, payload: { status: "succeeded" } };
      },
    };
    const adapter = new AgentDockLlmAdapter(gateway as never);
    const chunks = [];
    for await (const chunk of adapter.stream({
      provider: "agentdock", model: "bound", sessionId: "dsh-1" as never,
      messages: [{ role: "user", content: [{ type: "text", text: "Say hello" }] }] as never,
    })) chunks.push(chunk);
    expect(chunks).toEqual([
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "Codex reply" },
      { type: "block-end", index: 0, block: { type: "text", text: "Codex reply" } },
      { type: "finish", reason: { kind: "stop" } },
    ]);
  });

  it("lists enabled AgentDock agents as DSH models and auto-selects the chosen route", async () => {
    const calls: Array<{ sessionId: string; task: string; agentId?: string }> = [];
    const gateway = {
      async catalog() {
        return {
          agents: [
            { id: "codex-reviewer", engineId: "codex", environmentId: "review", enabled: true },
            { id: "disabled", engineId: "codex", environmentId: "old", enabled: false },
          ],
          projects: [],
        };
      },
      async *invoke(sessionId: string, task: string, _signal?: AbortSignal, agentId?: string) {
        calls.push({ sessionId, task, ...(agentId === undefined ? {} : { agentId }) });
        yield { runId: "run-1", sequence: 0, timestamp: "2026-01-01T00:00:00.000Z", type: "message" as const, payload: { text: "done" } };
        yield { runId: "run-1", sequence: 1, timestamp: "2026-01-01T00:00:01.000Z", type: "status" as const, payload: { status: "succeeded" } };
      },
    };
    const adapter = new AgentDockLlmAdapter(gateway as never);
    await expect(adapter.listModels("agentdock")).resolves.toEqual([
      { provider: "agentdock", id: modelIdForAgent("codex-reviewer"), name: "codex-reviewer", description: "AgentDock · codex · review" },
      { provider: "agentdock", id: "bound", name: "Manually bound AgentDock agent", description: "Compatibility option for a route configured in AgentDock Settings." },
    ]);
    for await (const _chunk of adapter.stream({
      provider: "agentdock", model: modelIdForAgent("codex-reviewer"), sessionId: "dsh-2" as never,
      messages: [{ role: "user", content: [{ type: "text", text: "Review this" }] }] as never,
    })) { /* consume the stream */ }
    expect(calls).toEqual([{ sessionId: "dsh-2", task: "Review this", agentId: "codex-reviewer" }]);
  });
});
