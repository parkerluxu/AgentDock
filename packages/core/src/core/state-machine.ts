import { InvalidRunTransitionError } from "./errors.js";
import type { RunStatus } from "./types.js";

const transitions: Record<RunStatus, readonly RunStatus[]> = {
  // A deterministic or cached Adapter may complete before it emits a running event.
  queued: ["running", "succeeded", "failed", "cancelled", "timed_out"],
  running: ["succeeded", "failed", "cancelled", "timed_out"],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return transitions[from].includes(to);
}

export function transitionRun(from: RunStatus, to: RunStatus): RunStatus {
  if (!canTransitionRun(from, to)) {
    throw new InvalidRunTransitionError(from, to);
  }
  return to;
}

export function allowedRunTransitions(from: RunStatus): readonly RunStatus[] {
  return transitions[from];
}
