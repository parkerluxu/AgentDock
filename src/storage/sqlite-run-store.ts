import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Policy, Profile, Project, Run, RunEvent, RunStatus, RuntimeDescriptor, Session } from "../core/types.js";

interface SessionRow {
  id: string;
  project_id: string | null;
  runtime_id: string;
  runtime_session_id: string | null;
  resumable: number;
  status: Session["status"];
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  runtime_id: string;
  profile_id: string;
  project_id: string | null;
  session_id: string | null;
  task: string;
  status: RunStatus;
  snapshot_json: string;
  created_at: string;
  owner_pid: number | null;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  error_code: string | null;
}

interface RunEventRow {
  run_id: string;
  sequence: number;
  timestamp: string;
  type: RunEvent["type"];
  payload_json: string;
}

interface IdempotencyRow {
  key: string;
  request_hash: string;
  run_id: string;
  owner_pid: number;
  created_at: string;
}

export type IdempotencyReservation =
  | { status: "created" }
  | { status: "existing"; runId: string }
  | { status: "in_progress"; runId: string }
  | { status: "conflict" };

export interface CreateSessionInput {
  id: string;
  projectId?: string;
  runtimeId: string;
  runtimeSessionId?: string;
  resumable: boolean;
  createdAt?: string;
}

export interface CreateRunInput {
  id: string;
  runtimeId: string;
  profileId: string;
  projectId?: string;
  sessionId?: string;
  task: string;
  snapshot: Run["snapshot"];
  createdAt?: string;
  ownerPid?: number;
}

export class SqliteRunStore {
  private readonly database: DatabaseSync;
  private readonly runById: StatementSync;
  private readonly eventByRun: StatementSync;

  public constructor(databasePath: string) {
    const absolutePath = resolve(databasePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.database = new DatabaseSync(absolutePath);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
    this.runById = this.database.prepare("SELECT * FROM runs WHERE id = ?");
    this.eventByRun = this.database.prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence ASC");
  }

  public close(): void {
    this.database.close();
  }

  public createSession(input: CreateSessionInput): Session {
    const now = input.createdAt ?? new Date().toISOString();
    this.database.prepare(`
      INSERT INTO sessions (id, project_id, runtime_id, runtime_session_id, resumable, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(input.id, input.projectId ?? null, input.runtimeId, input.runtimeSessionId ?? null, input.resumable ? 1 : 0, now, now);
    return {
      id: input.id,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      runtimeId: input.runtimeId,
      ...(input.runtimeSessionId ? { runtimeSessionId: input.runtimeSessionId } : {}),
      resumable: input.resumable,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
  }

  public getSession(id: string): Session | undefined {
    const row = this.database.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  public listSessions(): Session[] {
    return (this.database.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() as unknown as SessionRow[]).map(sessionFromRow);
  }

  public updateSession(id: string, patch: { status?: Session["status"]; runtimeSessionId?: string; resumable?: boolean }): Session {
    const existing = this.getSession(id);
    if (!existing) throw new Error(`Session "${id}" was not found.`);
    const updatedAt = new Date().toISOString();
    this.database.prepare(`
      UPDATE sessions SET runtime_session_id = ?, resumable = ?, status = ?, updated_at = ? WHERE id = ?
    `).run(patch.runtimeSessionId ?? existing.runtimeSessionId ?? null, (patch.resumable ?? existing.resumable) ? 1 : 0, patch.status ?? existing.status, updatedAt, id);
    return this.getSession(id) as Session;
  }

  public createRun(input: CreateRunInput): Run {
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.database.prepare(`
      INSERT INTO runs (id, runtime_id, profile_id, project_id, session_id, task, status, snapshot_json, created_at, owner_pid, started_at, finished_at, exit_code, error_code)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, NULL, NULL, NULL, NULL)
    `).run(input.id, input.runtimeId, input.profileId, input.projectId ?? null, input.sessionId ?? null, input.task, JSON.stringify(input.snapshot), createdAt, input.ownerPid ?? null);
    return {
      id: input.id,
      runtimeId: input.runtimeId,
      profileId: input.profileId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      task: input.task,
      status: "queued",
      snapshot: input.snapshot,
      createdAt,
      ...(input.ownerPid !== undefined ? { ownerPid: input.ownerPid } : {}),
    };
  }

  public getRun(id: string): Run | undefined {
    const row = this.runById.get(id) as unknown as RunRow | undefined;
    return row ? runFromRow(row) : undefined;
  }

  public listRuns(options?: { status?: RunStatus; projectId?: string; limit?: number }): Run[] {
    const conditions: string[] = [];
    const values: string[] = [];
    if (options?.status) {
      conditions.push("status = ?");
      values.push(options.status);
    }
    if (options?.projectId) {
      conditions.push("project_id = ?");
      values.push(options.projectId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options?.limit && options.limit > 0 ? Math.floor(options.limit) : 100;
    const rows = this.database.prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC LIMIT ${limit}`).all(...values) as unknown as RunRow[];
    return rows.map(runFromRow);
  }

  public updateRun(id: string, patch: { status?: RunStatus; startedAt?: string; finishedAt?: string; exitCode?: number; errorCode?: string }): Run {
    const existing = this.getRun(id);
    if (!existing) throw new Error(`Run "${id}" was not found.`);
    const status = patch.status ?? existing.status;
    this.database.prepare(`
      UPDATE runs SET status = ?, started_at = ?, finished_at = ?, exit_code = ?, error_code = ? WHERE id = ?
    `).run(
      status,
      patch.startedAt ?? existing.startedAt ?? null,
      patch.finishedAt ?? existing.finishedAt ?? null,
      patch.exitCode ?? existing.exitCode ?? null,
      patch.errorCode ?? existing.errorCode ?? null,
      id,
    );
    return this.getRun(id) as Run;
  }

  public appendEvent(event: RunEvent): void {
    this.database.prepare(`
      INSERT INTO run_events (run_id, sequence, timestamp, type, payload_json) VALUES (?, ?, ?, ?, ?)
    `).run(event.runId, event.sequence, event.timestamp, event.type, JSON.stringify(event.payload));
  }

  public reserveIdempotencyKey(key: string, requestHash: string, runId: string, ownerPid = process.pid): IdempotencyReservation {
    const inserted = this.database.prepare(`
      INSERT OR IGNORE INTO api_idempotency_keys (key, request_hash, run_id, owner_pid, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(key, requestHash, runId, ownerPid, new Date().toISOString());
    if (Number(inserted.changes) === 1) return { status: "created" };

    const existing = this.database.prepare("SELECT * FROM api_idempotency_keys WHERE key = ?").get(key) as IdempotencyRow | undefined;
    if (!existing) return { status: "created" };
    if (existing.request_hash !== requestHash) return { status: "conflict" };
    const existingRun = this.getRun(existing.run_id);
    if (existingRun) return { status: "existing", runId: existing.run_id };
    if (processIsRunning(existing.owner_pid)) return { status: "in_progress", runId: existing.run_id };

    const replaced = this.database.prepare(`
      UPDATE api_idempotency_keys
      SET request_hash = ?, run_id = ?, owner_pid = ?, created_at = ?
      WHERE key = ? AND run_id = ? AND owner_pid = ?
    `).run(requestHash, runId, ownerPid, new Date().toISOString(), key, existing.run_id, existing.owner_pid);
    return Number(replaced.changes) === 1 ? { status: "created" } : { status: "in_progress", runId: existing.run_id };
  }

  public releaseIdempotencyKey(key: string, runId: string): void {
    this.database.prepare("DELETE FROM api_idempotency_keys WHERE key = ? AND run_id = ?").run(key, runId);
  }

  public listEvents(runId: string): RunEvent[] {
    return (this.eventByRun.all(runId) as unknown as RunEventRow[]).map((row) => ({
      runId: row.run_id,
      sequence: row.sequence,
      timestamp: row.timestamp,
      type: row.type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    }));
  }

  public recoverStaleRuns(activeRunIds: Set<string> = new Set()): Run[] {
    const running = this.database.prepare("SELECT id, owner_pid FROM runs WHERE status IN ('queued', 'running')").all() as unknown as Array<{ id: string; owner_pid: number | null }>;
    const recovered: Run[] = [];
    for (const row of running) {
      if (activeRunIds.has(row.id)) continue;
      if (row.owner_pid !== null && processIsRunning(row.owner_pid)) continue;
      const run = this.updateRun(row.id, { status: "failed", finishedAt: new Date().toISOString(), errorCode: "PROCESS_NOT_ACTIVE_AFTER_RESTART" });
      const nextSequence = this.listEvents(row.id).at(-1)?.sequence ?? -1;
      this.appendEvent({
        runId: row.id,
        sequence: nextSequence + 1,
        timestamp: new Date().toISOString(),
        type: "error",
        payload: { status: "failed", errorCode: "PROCESS_NOT_ACTIVE_AFTER_RESTART" },
      });
      recovered.push(run);
    }
    return recovered;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        runtime_id TEXT NOT NULL,
        runtime_session_id TEXT,
        resumable INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        project_id TEXT,
        session_id TEXT REFERENCES sessions(id),
        task TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        owner_pid INTEGER,
        started_at TEXT,
        finished_at TEXT,
        exit_code INTEGER,
        error_code TEXT
      );
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('status', 'message', 'tool_call', 'tool_result', 'error')),
        payload_json TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, sequence);
      CREATE TABLE IF NOT EXISTS api_idempotency_keys (
        key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        run_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const migration = this.database.prepare("SELECT version FROM schema_migrations WHERE version = 1").get();
    if (!migration) this.database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
    const ownerPidMigration = this.database.prepare("SELECT version FROM schema_migrations WHERE version = 2").get();
    if (!ownerPidMigration) {
      const columns = this.database.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "owner_pid")) this.database.exec("ALTER TABLE runs ADD COLUMN owner_pid INTEGER");
      this.database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)").run(new Date().toISOString());
    }
    const idempotencyMigration = this.database.prepare("SELECT version FROM schema_migrations WHERE version = 3").get();
    if (!idempotencyMigration) this.database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)").run(new Date().toISOString());
  }
}

function sessionFromRow(row: SessionRow): Session {
  return {
    id: row.id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    runtimeId: row.runtime_id,
    ...(row.runtime_session_id ? { runtimeSessionId: row.runtime_session_id } : {}),
    resumable: row.resumable === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === "object" && "code" in error && String(error.code) === "ESRCH");
  }
}

function runFromRow(row: RunRow): Run {
  return {
    id: row.id,
    runtimeId: row.runtime_id,
    profileId: row.profile_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    task: row.task,
    status: row.status,
    snapshot: JSON.parse(row.snapshot_json) as Run["snapshot"],
    createdAt: row.created_at,
    ...(row.owner_pid !== null ? { ownerPid: row.owner_pid } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.exit_code !== null ? { exitCode: row.exit_code } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
  };
}
