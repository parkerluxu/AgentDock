import { redactSensitiveValue, type RedactionOptions } from "./redaction.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: Pick<NodeJS.WritableStream, "write">;
  redaction?: RedactionOptions;
}

const levelOrder: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class AgentDockLogger implements Logger {
  private readonly level: LogLevel;
  private readonly sink: Pick<NodeJS.WritableStream, "write">;
  private readonly redaction: RedactionOptions;

  public constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "warn";
    this.sink = options.sink ?? process.stderr;
    this.redaction = options.redaction ?? {};
  }

  public debug(message: string, fields: Record<string, unknown> = {}): void {
    this.write("debug", message, fields);
  }

  public info(message: string, fields: Record<string, unknown> = {}): void {
    this.write("info", message, fields);
  }

  public warn(message: string, fields: Record<string, unknown> = {}): void {
    this.write("warn", message, fields);
  }

  public error(message: string, fields: Record<string, unknown> = {}): void {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    if (levelOrder[level] < levelOrder[this.level]) return;
    const record = redactSensitiveValue({ timestamp: new Date().toISOString(), level, message, ...fields }, [], this.redaction);
    this.sink.write(`${JSON.stringify(record)}\n`);
  }
}
