import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apply, RPC_METHOD } from "../src/host.js";

describe("DeepSeek Harness plugin", () => {
  it("manages an AgentDock config through DSH's authenticated RPC carrier", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-dsh-plugin-"));
    let route: { fetch(request: Request): Promise<Response> } | undefined;
    const connection = { fetch: { register: (input: typeof route) => { route = input; return () => undefined; } } };
    const context = {
      inject: (_dependencies: string[], callback: (value: { connection: typeof connection }) => unknown) => callback({ connection }),
      get: () => connection,
      effect: (callback: () => void | (() => void)) => callback(),
      llm: { registerAdapter: () => () => undefined },
      sessionController: { selectModel: async () => undefined },
      logger: { info: () => undefined, warn: () => undefined },
    };
    try {
      apply(context, { configPath: join(directory, "config.json") });
      expect(route).toBeDefined();
      const request = async (endpoint: string, payload: unknown): Promise<{ ok: boolean; value?: any }> => {
        const response = await route!.fetch(new Request("http://localhost/api/agentDock", {
          method: "POST",
          body: JSON.stringify({ method: RPC_METHOD, rpcId: "rpc-1", payload: { endpoint, payload } }),
        }));
        const envelope = await response.json() as { result: { ok: boolean; value?: any } };
        return envelope.result;
      };
      const initial = await request("snapshot", {});
      expect(initial.ok).toBe(true);
      expect(initial.value.config.agents).toEqual([]);

      const config = { ...initial.value.config, engines: [{ id: "echo", adapter: "echo", args: [], enabled: true, capabilities: ["execute"] }] };
      const saved = await request("save", { config, revision: initial.value.revision, hash: initial.value.hash, confirmHighRisk: true });
      expect(saved.ok).toBe(true);
      expect(saved.value.current.config.engines).toHaveLength(1);

      const backups = await request("backups", {});
      expect(backups.value.backups).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
