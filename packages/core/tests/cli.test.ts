import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

describe("Agent-first CLI invocation", () => {
  it("rejects an Environment override with a machine-readable error", async () => {
    const tsxCli = require.resolve("tsx/cli");
    const cli = join(process.cwd(), "src", "cli.ts");
    await expect(execFileAsync(process.execPath, [tsxCli, cli, "agent", "run", "default", "--environment", "default", "inspect"], {
      cwd: process.cwd(),
    })).rejects.toMatchObject({
      code: 2,
      stdout: expect.stringContaining('"code":"AGENT_ENVIRONMENT_OVERRIDE_UNSUPPORTED"'),
    });
  });

  it("creates and applies a config-only Environment template with explicit confirmation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentdock-cli-template-"));
    const configPath = join(directory, "config.json");
    const tsxCli = require.resolve("tsx/cli");
    const cli = join(process.cwd(), "src", "cli.ts");
    const invoke = (args: string[]) => execFileAsync(process.execPath, [tsxCli, cli, ...args, "--config", configPath], { cwd: process.cwd() });
    try {
      writeFileSync(configPath, JSON.stringify({
        version: 1,
        dataDir: "data",
        engines: [{ id: "echo", adapter: "echo", capabilities: ["execute"] }],
        environmentPermissions: [{ id: "readonly", filesystem: { roots: ["."], write: false }, environment: { allow: [] }, network: "deny" }],
        environments: [{ id: "source", engineId: "echo", permissionId: "readonly", directoryMode: "managed" }],
        projects: [],
      }));
      const initialRescan = await invoke(["environment", "rescan", "source"]);
      const sourceConfig = (JSON.parse(initialRescan.stdout) as { configDir: string }).configDir;
      writeFileSync(join(sourceConfig, "agent.json"), "portable\n");
      writeFileSync(join(sourceConfig, "auth.json"), "cli-template-token-must-not-copy\n");
      await invoke(["environment", "rescan", "source"]);

      const created = await invoke(["environment", "template", "create", "cli-review", "source"]);
      expect(JSON.parse(created.stdout) as { id: string; skipped: Record<string, number> }).toMatchObject({ id: "cli-review", skipped: { secret: expect.any(Number) } });
      const listed = await invoke(["environment", "template", "list"]);
      expect(JSON.parse(listed.stdout) as Array<{ id: string }>).toMatchObject([{ id: "cli-review" }]);

      await expect(invoke(["environment", "template", "apply", "cli-review", "derived"])).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining('"code":"CONFIG_CONFIRMATION_REQUIRED"'),
      });
      expect(existsSync(join(dirname(dirname(sourceConfig)), "derived", "config"))).toBe(false);

      const applied = await invoke(["environment", "template", "apply", "cli-review", "derived", "--confirm-high-risk"]);
      const body = JSON.parse(applied.stdout) as { environment: { id: string }; manifest: { configDir: string } };
      expect(body.environment.id).toBe("derived");
      expect(readFileSync(join(body.manifest.configDir, "agent.json"), "utf8")).toBe("portable\n");
      expect(existsSync(join(body.manifest.configDir, "auth.json"))).toBe(false);
      expect(JSON.parse(readFileSync(configPath, "utf8")) as { environments: Array<{ id: string }> }).toMatchObject({ environments: [{ id: "source" }, { id: "derived", directoryMode: "managed" }] });
      const diagnosed = await invoke(["environment", "doctor", "derived"]);
      expect(JSON.parse(diagnosed.stdout) as { healthy: boolean; isSecuritySandbox: boolean; diagnostics: Array<{ id: string; scope: string }> }).toMatchObject({
        healthy: true,
        isSecuritySandbox: false,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ scope: "environment", id: "derived/manifest" }),
          expect.objectContaining({ scope: "permission", id: "derived/derived" }),
        ]),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
