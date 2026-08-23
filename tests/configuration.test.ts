import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { validateConfig } from "../src/config/load.js";
import { configDataPath } from "../src/runtime/configuration.js";

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() as string, { recursive: true, force: true });
});

function createConfig(dataDir?: string) {
  return validateConfig({
    version: 1,
    ...(dataDir ? { dataDir } : {}),
    runtimes: [],
    profiles: [],
    projects: [],
  });
}

describe("configDataPath", () => {
  it("stores new data in agentdock.db beneath the configured data directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-configuration-"));
    directories.push(directory);

    expect(configDataPath(createConfig("data"), join(directory, "config.json"))).toBe(join(directory, "data", "agentdock.db"));
  });

  it("continues using an existing legacy database file at dataDir", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-configuration-"));
    directories.push(directory);
    const legacyPath = join(directory, "data");
    mkdirSync(directory, { recursive: true });
    writeFileSync(legacyPath, "SQLite format 3");

    expect(configDataPath(createConfig("data"), join(directory, "config.json"))).toBe(legacyPath);
  });
});
