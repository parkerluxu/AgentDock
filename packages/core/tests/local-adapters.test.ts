import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { LocalAdapterStore, registerEnabledLocalAdapters } from "../src/runtime/local-adapters.js";
import { RuntimeRegistry } from "../src/runtime/registry.js";
import type { RuntimeDescriptor } from "../src/core/types.js";

const runtime: RuntimeDescriptor = {
  id: "local-fixture",
  adapter: "local-fixture",
  args: [],
  enabled: true,
  capabilities: ["execute", "stream_events", "cancel", "healthcheck"],
};

describe("Local Adapter lifecycle", () => {
  it("installs disabled with no grants, then loads only after explicit enablement", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-local-adapter-"));
    const source = createAdapterPackage(directory, "local-fixture", "./index.mjs", ["filesystem.read"]);
    const store = new LocalAdapterStore(join(directory, "registry"));
    try {
      const installed = store.install(source);
      expect(installed).toMatchObject({ enabled: false, grantedPermissions: [], manifest: { name: "local-fixture" } });
      expect(store.list()).toHaveLength(1);
      expect(() => store.enable("local-fixture")).toThrow(/explicit permission grant/);

      const enabled = store.enable("local-fixture", ["filesystem.read"]);
      expect(enabled).toMatchObject({ enabled: true, grantedPermissions: ["filesystem.read"] });
      const registry = new RuntimeRegistry();
      await registerEnabledLocalAdapters(store, registry);
      const adapter = registry.create(runtime);
      expect(adapter.manifest).toMatchObject({ name: "local-fixture", runtime: { id: "local-fixture" } });
      expect((await adapter.healthCheck()).healthy).toBe(true);

      store.disable("local-fixture");
      const disabledRegistry = new RuntimeRegistry();
      await registerEnabledLocalAdapters(store, disabledRegistry);
      expect(disabledRegistry.list()).toEqual([]);
      store.uninstall("local-fixture");
      expect(new LocalAdapterStore(join(directory, "registry")).list()).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an entry that escapes the local Adapter package", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-local-adapter-path-"));
    const source = join(directory, "source");
    mkdirSync(source);
    writeFileSync(join(source, "manifest.json"), JSON.stringify({
      name: "path-fixture",
      version: "0.1.0",
      entry: "../outside.mjs",
      agentDockApi: "v1",
      runtime: { id: "path-fixture" },
      capabilities: ["execute", "cancel", "healthcheck"],
      requiredPermissions: [],
    }));
    writeFileSync(join(directory, "outside.mjs"), "export const createAdapter = () => ({});\n");
    try {
      expect(() => new LocalAdapterStore(join(directory, "registry")).install(source)).toThrow(/must be inside/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a manifest name that could escape the Adapter registry directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-local-adapter-name-"));
    const source = join(directory, "source");
    mkdirSync(source);
    writeFileSync(join(source, "manifest.json"), JSON.stringify({
      name: "../outside",
      version: "0.1.0",
      entry: "./index.mjs",
      agentDockApi: "v1",
      runtime: { id: "outside" },
      capabilities: ["execute", "cancel", "healthcheck"],
      requiredPermissions: [],
    }));
    writeFileSync(join(source, "index.mjs"), "export const createAdapter = () => ({});\n");
    try {
      expect(() => new LocalAdapterStore(join(directory, "registry")).install(source)).toThrow(/lowercase identifier/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires disabling an Adapter before uninstalling it", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-local-adapter-uninstall-"));
    const source = createAdapterPackage(directory, "uninstall-fixture", "./index.mjs", []);
    const store = new LocalAdapterStore(join(directory, "registry"));
    try {
      store.install(source);
      store.enable("uninstall-fixture");
      expect(() => store.uninstall("uninstall-fixture")).toThrow(/Disable local Adapter/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function createAdapterPackage(root: string, name: string, entry: string, requiredPermissions: string[]): string {
  const source = join(root, `${name}-source`);
  mkdirSync(source);
  writeFileSync(join(source, "agentdock-adapter.json"), JSON.stringify({
    name,
    version: "0.1.0",
    entry,
    agentDockApi: "v1",
    runtime: { id: name, versionRange: "*" },
    capabilities: ["execute", "stream_events", "cancel", "healthcheck"],
    requiredPermissions,
  }));
  writeFileSync(join(source, "index.mjs"), `
export function createAdapter(runtime) {
  const manifest = {
    name: "${name}",
    version: "0.1.0",
    entry: "./index.mjs",
    agentDockApi: "v1",
    runtime: { id: "${name}", versionRange: "*" },
    capabilities: ["execute", "stream_events", "cancel", "healthcheck"],
    requiredPermissions: ${JSON.stringify(requiredPermissions)}
  };
  return {
    manifest,
    async healthCheck() { return { healthy: true, runtime }; },
    async *execute(request) {
      yield { runId: request.runId, sequence: 0, timestamp: new Date().toISOString(), type: "status", payload: { status: "succeeded" } };
    },
    async cancel() {}
  };
}
`);
  return source;
}
