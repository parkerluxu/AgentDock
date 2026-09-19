import { describe, expect, it } from "vitest";
import { ConfigValidationError, loadConfig } from "../src/config/load.js";

describe("configuration loading", () => {
  it("turns a missing file into a structured validation error", async () => {
    await expect(loadConfig("this-file-does-not-exist.json")).rejects.toMatchObject({
      name: "ConfigValidationError",
      issues: [{ message: "File does not exist." }],
    } satisfies Partial<ConfigValidationError>);
  });
});
