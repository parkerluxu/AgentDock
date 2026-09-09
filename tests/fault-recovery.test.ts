import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/config/load.js";
import { doctor } from "../src/runtime/doctor.js";
import { RuntimeRegistry } from "../src/runtime/registry.js";

describe("fault recovery diagnostics", () => {
  it("reports a corrupted SQLite file as an unhealthy storage diagnostic", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-corrupt-db-"));
    const databasePath = join(directory, "data", "agentdock.db");
    mkdirSync(join(directory, "data"), { recursive: true });
    writeFileSync(databasePath, "this is not a sqlite database");
    const config = validateConfig({ version: 1, dataDir: "data", engines: [], environments: [], projects: [], environmentPermissions: [] });
    try {
      const report = await doctor({ config, configPath: join(directory, "config.json"), registry: new RuntimeRegistry() });
      expect(report.healthy).toBe(false);
      expect(report.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: "storage", id: "sqlite", healthy: false }),
      ]));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
