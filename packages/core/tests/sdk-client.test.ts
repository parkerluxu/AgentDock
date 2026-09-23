import { describe, expect, it } from "vitest";
import type { Run } from "../src/core/types.js";
import { AgentDockClient, AgentDockClientError } from "../src/sdk/client.js";

function streamResponse(frames: string[], fail = false): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (fail) controller.error(new Error("simulated disconnect"));
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("AgentDock local SDK", () => {
  it("reconnects an invocation after a dropped SSE stream and deduplicates sequences", async () => {
    const calls: Array<{ url: string; method: string; idempotencyKey: string | null }> = [];
    const runId = "run-sdk-1";
    const run = { id: runId, status: "succeeded" } as unknown as Run;
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, method: init?.method ?? "GET", idempotencyKey: headers.get("idempotency-key") });
      if (url.endsWith("/agents/reviewer/invoke")) {
        return streamResponse([
          ": agentdock event stream\n\n",
          `event: accepted\ndata: ${JSON.stringify({ runId, created: true, eventsUrl: `/api/v1/runs/${runId}/events` })}\n\n`,
          `id: 0\nevent: status\ndata: ${JSON.stringify({ runId, sequence: 0, timestamp: "2026-09-12T00:00:00.000Z", type: "status", payload: { status: "queued" } })}\n\n`,
        ], true);
      }
      if (url.includes(`/runs/${runId}/events?after=0`)) {
        return streamResponse([
          `id: 0\nevent: status\ndata: ${JSON.stringify({ runId, sequence: 0, timestamp: "2026-09-12T00:00:00.000Z", type: "status", payload: { status: "queued" } })}\n\n`,
          `id: 1\nevent: status\ndata: ${JSON.stringify({ runId, sequence: 1, timestamp: "2026-09-12T00:00:00.001Z", type: "status", payload: { status: "running" } })}\n\n`,
          `id: 2\nevent: message\ndata: ${JSON.stringify({ runId, sequence: 2, timestamp: "2026-09-12T00:00:00.002Z", type: "message", payload: { text: "done" } })}\n\n`,
          `id: 3\nevent: status\ndata: ${JSON.stringify({ runId, sequence: 3, timestamp: "2026-09-12T00:00:00.003Z", type: "status", payload: { status: "succeeded", exitCode: 0 } })}\n\n`,
        ]);
      }
      if (url.endsWith(`/runs/${runId}`)) return new Response(JSON.stringify({ run }), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`Unexpected SDK request: ${url}`);
    };

    const received: string[] = [];
    const result = await new AgentDockClient({ baseUrl: "http://agentdock.test/api/v1", token: "sdk-token", fetch: fetcher, reconnectDelayMs: 0 }).agent("reviewer").run({
      task: "inspect",
      projectId: "workspace",
      onEvent: (event) => received.push(event.type === "accepted" ? "accepted" : `${event.type}:${event.sequence}`),
    });

    expect(result.runId).toBe(runId);
    expect(result.run.status).toBe("succeeded");
    expect(result.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    expect(received).toEqual(["accepted", "status:0", "status:1", "message:2", "status:3"]);
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET", "GET"]);
    expect(calls[0]?.idempotencyKey).toBeTruthy();
    expect(calls[1]?.url).toContain("after=0");
  });

  it("preserves a stable API error code for callers", async () => {
    const fetcher: typeof globalThis.fetch = async () => new Response(JSON.stringify({
      error: { code: "SESSION_ENVIRONMENT_MISMATCH", message: "The Session belongs to another Environment." },
    }), { status: 409, headers: { "content-type": "application/json" } });
    const client = new AgentDockClient({ baseUrl: "http://agentdock.test/api/v1", token: "sdk-token", fetch: fetcher, maxReconnects: 0 });
    await expect(client.agent("reviewer").run({ task: "resume", sessionId: "session-1" })).rejects.toMatchObject({
      name: "AgentDockClientError",
      statusCode: 409,
      code: "SESSION_ENVIRONMENT_MISMATCH",
    } satisfies Partial<AgentDockClientError>);
  });

  it("returns a non-mutating routing explanation for an unroutable request", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetcher: typeof globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe("http://agentdock.test/api/v1/routing/preview");
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        task: "inspect",
        executes: false,
        routing: {
          resolved: false,
          candidates: [{ agentId: "reviewer", environmentId: "review", engineId: "codex", health: "unknown", accepted: false, reasons: ["Network permission does not match"] }],
          explanation: "No configured Agent can satisfy the requested route.",
          error: { code: "NO_ROUTE_CANDIDATE", message: "No configured Agent can satisfy the requested route." },
        },
        error: { code: "NO_ROUTE_CANDIDATE", message: "No configured Agent can satisfy the requested route." },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new AgentDockClient({ baseUrl: "http://agentdock.test/api/v1", token: "sdk-token", fetch: fetcher });
    const result = await client.previewRouting({ task: "inspect", projectId: "workspace", network: "allow" });
    expect(requestBody).toMatchObject({ task: "inspect", projectId: "workspace", network: "allow" });
    expect(result).toMatchObject({ executes: false, error: { code: "NO_ROUTE_CANDIDATE" } });
  });
});
