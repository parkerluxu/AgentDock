import type { RunEvent } from "../core/types.js";

export function parseJsonLines(text: string, runId: string, startSequence = 0): RunEvent[] {
  const events: RunEvent[] = [];
  let sequence = startSequence;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      events.push({ runId, sequence: sequence++, timestamp: new Date().toISOString(), type: "message", payload: { text: trimmed } });
      continue;
    }
    events.push(normalizeRuntimeEvent(parsed, runId, sequence++));
  }
  return events;
}

export function normalizeRuntimeEvent(value: unknown, runId: string, sequence: number): RunEvent {
  const object = isRecord(value) ? value : { value };
  const rawType = typeof object.type === "string" ? object.type : "message";
  let type: RunEvent["type"] = "message";
  if (/error|failed/i.test(rawType)) type = "error";
  else if (/tool_use|tool_call/i.test(rawType)) type = "tool_call";
  else if (/tool_result/i.test(rawType)) type = "tool_result";
  else if (/result|completed|succeeded|status/i.test(rawType)) type = "status";
  return { runId, sequence, timestamp: new Date().toISOString(), type, payload: object };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
