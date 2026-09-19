import { describe, expect, it } from "vitest";
import { createMemoryRepository } from "../src/storage/repository.js";

describe("memory repository", () => {
  it("upserts, lists and deletes entities by stable id", () => {
    const repository = createMemoryRepository();
    repository.engines.upsert({
      id: "codex",
      adapter: "codex",
      args: [],
      enabled: true,
      capabilities: ["execute"],
    });

    expect(repository.engines.get("codex")?.adapter).toBe("codex");
    expect(repository.engines.list()).toHaveLength(1);
    expect(repository.engines.delete("codex")).toBe(true);
    expect(repository.engines.get("codex")).toBeUndefined();
    expect(repository.engines.delete("missing")).toBe(false);
  });
});
