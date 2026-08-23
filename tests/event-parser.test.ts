import { describe, expect, it } from "vitest";
import { normalizeRuntimeEvent, parseJsonLines } from "../src/runtime/event-parser.js";

describe("runtime event parser", () => {
  it("normalizes JSONL and plain text into RunEvents", () => {
    const events = parseJsonLines('{"type":"tool_use","name":"Read"}\nplain output\n', "run-1");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ runId: "run-1", type: "tool_call", sequence: 0 });
    expect(events[1]).toMatchObject({ type: "message", payload: { text: "plain output" }, sequence: 1 });
  });

  it("maps failed runtime events to error", () => {
    expect(normalizeRuntimeEvent({ type: "error", message: "nope" }, "run-2", 3)).toMatchObject({
      type: "error",
      sequence: 3,
    });
  });
});
