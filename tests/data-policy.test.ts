import { describe, expect, it } from "vitest";
import { AgentDockLogger } from "../src/core/logger.js";
import { redactSensitiveValue } from "../src/core/redaction.js";

describe("data and logging policy", () => {
  it("redacts default and configured sensitive object keys", () => {
    const value = redactSensitiveValue({ token: "secret", password: "pw", internalCode: "hidden", safe: "visible" }, [], { additionalKeys: ["internalCode"] });
    expect(value).toEqual({ token: "[REDACTED]", password: "[REDACTED]", internalCode: "[REDACTED]", safe: "visible" });
  });

  it("honors the configured logger level and redacts fields", () => {
    const lines: string[] = [];
    const logger = new AgentDockLogger({ level: "info", redaction: { additionalKeys: ["requestBody"] }, sink: { write: (line: string) => { lines.push(line); return true; } } });
    logger.debug("ignored");
    logger.info("accepted", { requestBody: "private" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ level: "info", message: "accepted", requestBody: "[REDACTED]" });
  });
});
