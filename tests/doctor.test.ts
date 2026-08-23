import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config/load.js";
import { doctor } from "../src/runtime/doctor.js";
import { RuntimeRegistry } from "../src/runtime/registry.js";

describe("doctor", () => {
  it("reports an unregistered Adapter without running a process", async () => {
    const config = validateConfig({
      version: 1,
      dataDir: ".agentdock-test-data",
      runtimes: [{ id: "unknown", adapter: "not-installed" }],
      profiles: [],
      projects: [],
    });
    const report = await doctor({ config, configPath: process.cwd(), registry: new RuntimeRegistry(), checkStorage: false });
    expect(report.healthy).toBe(false);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      { scope: "runtime", id: "unknown", healthy: false, message: 'Adapter "not-installed" is not registered.' },
    ]));
  });
});
