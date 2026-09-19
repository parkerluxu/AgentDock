import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentDockGateway } from "../src/gateway.js";

const tokenKey = "AGENTDOCK_DSH_TEST_TOKEN";
const originalFetch = globalThis.fetch;
const originalToken = process.env[tokenKey];

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env[tokenKey];
  else process.env[tokenKey] = originalToken;
});

describe("AgentDock DSH gateway", () => {
  it("keeps a distinct AgentDock session behind a bound DSH session and streams its events", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-dsh-gateway-"));
    process.env[tokenKey] = "test-token";
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      calls.push({ path: url.pathname, method: init?.method ?? "GET", ...(body === undefined ? {} : { body }) });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
      if (url.pathname.endsWith("/agents")) return Response.json({ agents: [{ id: "codex", engineId: "codex-cli", environmentId: "dev", enabled: true }] });
      if (url.pathname.endsWith("/projects")) return Response.json({ projects: [{ id: "workspace" }] });
      if (url.pathname.endsWith("/sessions")) return Response.json({ session: { id: "native-session-1" } }, { status: 201 });
      if (url.pathname.endsWith("/agents/codex/invoke")) {
        return new Response([
          "event: accepted\n", "data: {\"runId\":\"run-1\"}\n\n",
          "event: message\n", "data: {\"runId\":\"run-1\",\"sequence\":1,\"timestamp\":\"2026-01-01T00:00:00.000Z\",\"type\":\"message\",\"payload\":{\"text\":\"hello\"}}\n\n",
          "event: status\n", "data: {\"runId\":\"run-1\",\"sequence\":2,\"timestamp\":\"2026-01-01T00:00:01.000Z\",\"type\":\"status\",\"payload\":{\"status\":\"succeeded\"}}\n\n",
        ].join(""), { headers: { "content-type": "text/event-stream" } });
      }
      return new Response("not found", { status: 404 });
    };
    try {
      const gateway = new AgentDockGateway({ apiTokenEnv: tokenKey, bindingStorePath: join(directory, "bindings.json") });
      await gateway.bind({ dshSessionId: "dsh-session-a", agentId: "codex", projectId: "workspace" });
      const events = [];
      for await (const event of gateway.invoke("dsh-session-a", "say hello")) events.push(event);
      expect(events.map((event) => event.type)).toEqual(["message", "status"]);
      expect(calls.filter((call) => call.path.endsWith("/sessions"))).toHaveLength(1);
      const invoke = calls.find((call) => call.path.endsWith("/agents/codex/invoke"));
      expect(invoke?.body).toMatchObject({ task: "say hello", sessionId: "native-session-1", projectId: "workspace" });
      expect((await gateway.binding("dsh-session-a"))?.agentDockSessionId).toBe("native-session-1");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
