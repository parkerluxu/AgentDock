import { describe, expect, it } from "vitest";
import { isCapabilitySupported, type AdapterManifest } from "../src/adapter-contract/index.js";

describe("Adapter contract", () => {
  it("uses explicit capability declarations", () => {
    const manifest: AdapterManifest = {
      name: "example",
      version: "0.1.0",
      entry: "./example-adapter.js",
      agentDockApi: "v1",
      runtime: { id: "example" },
      capabilities: ["execute", "healthcheck"],
      requiredPermissions: ["filesystem.read"],
    };

    expect(isCapabilitySupported(manifest, "execute")).toBe(true);
    expect(isCapabilitySupported(manifest, "resume_session")).toBe(false);
  });
});
