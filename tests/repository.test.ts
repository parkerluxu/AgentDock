import { describe, expect, it } from "vitest";
import { createMemoryRepository } from "../src/storage/repository.js";

describe("memory repository", () => {
  it("upserts, lists and deletes entities by stable id", () => {
    const repository = createMemoryRepository();
    repository.runtimes.upsert({
      id: "codex",
      adapter: "codex",
      args: [],
      enabled: true,
      capabilities: ["execute"],
    });

    expect(repository.runtimes.get("codex")?.adapter).toBe("codex");
    expect(repository.runtimes.list()).toHaveLength(1);
    expect(repository.runtimes.delete("codex")).toBe(true);
    expect(repository.runtimes.get("codex")).toBeUndefined();
    expect(repository.runtimes.delete("missing")).toBe(false);
  });
});
