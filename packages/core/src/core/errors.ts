export class AgentDockError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentDockError";
    this.code = code;
  }
}

export class InvalidRunTransitionError extends AgentDockError {
  public constructor(from: string, to: string) {
    super("INVALID_RUN_TRANSITION", `Cannot transition Run from ${from} to ${to}.`);
  }
}
