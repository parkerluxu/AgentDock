import { describe, expect, it } from "vitest";
import { InvalidRunTransitionError } from "../src/core/errors.js";
import { canTransitionRun, transitionRun } from "../src/core/state-machine.js";

describe("Run state machine", () => {
  it("allows the normal lifecycle", () => {
    expect(canTransitionRun("queued", "running")).toBe(true);
    expect(transitionRun("queued", "running")).toBe("running");
    expect(transitionRun("running", "succeeded")).toBe("succeeded");
  });

  it("allows cancellation and timeout from active states", () => {
    expect(canTransitionRun("queued", "cancelled")).toBe(true);
    expect(canTransitionRun("queued", "failed")).toBe(true);
    expect(canTransitionRun("running", "timed_out")).toBe(true);
  });

  it("rejects transitions out of terminal states", () => {
    expect(() => transitionRun("succeeded", "running")).toThrow(InvalidRunTransitionError);
    expect(() => transitionRun("failed", "succeeded")).toThrow("Cannot transition Run");
  });
});
