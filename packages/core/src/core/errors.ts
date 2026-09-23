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

/**
 * Stable, public error codes for a Session that cannot be resumed by the
 * selected execution identity. These are shared by the CLI, API, and SDK
 * instead of making callers parse a human-readable error message.
 */
export type SessionIdentityErrorCode =
  | "SESSION_ENGINE_MISMATCH"
  | "SESSION_AGENT_MISMATCH"
  | "SESSION_ENVIRONMENT_MISMATCH"
  | "SESSION_ARCHIVED";

export class SessionIdentityError extends AgentDockError {
  public constructor(code: SessionIdentityErrorCode, message: string) {
    super(code, message);
    this.name = "SessionIdentityError";
  }
}

export class SessionNotFoundError extends AgentDockError {
  public constructor(sessionId: string) {
    super("SESSION_NOT_FOUND", `Session "${sessionId}" was not found.`);
    this.name = "SessionNotFoundError";
  }
}
