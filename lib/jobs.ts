import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db.ts";
import type { JobEventLevel, JobEventRow, JobRow, JobType } from "./job-types.ts";

type Db = Database.Database;

export type CreateJobOptions = {
  jobType: JobType;
  dedupeKey?: string | null;
  progressTotal?: number | null;
  db?: Db;
};

export type CreateJobResult = {
  job: JobRow;
  created: boolean;
};

function dbOrDefault(db?: Db): Db {
  return db ?? getDb();
}

function nowSql(): string {
  return new Date().toISOString();
}

function rowById(db: Db, id: string): JobRow | null {
  return (
    (db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined) ??
    null
  );
}

function activeByDedupeKey(db: Db, dedupeKey: string): JobRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM jobs
          WHERE dedupe_key = ? AND status IN ('queued', 'running')
          ORDER BY created_at ASC
          LIMIT 1`,
      )
      .get(dedupeKey) as JobRow | undefined) ?? null
  );
}

export function createJob(opts: CreateJobOptions): CreateJobResult {
  const db = dbOrDefault(opts.db);
  const dedupeKey = opts.dedupeKey ?? null;
  if (dedupeKey) {
    const existing = activeByDedupeKey(db, dedupeKey);
    if (existing) return { job: existing, created: false };
  }

  const id = randomUUID();
  const ts = nowSql();
  try {
    db.prepare(
      `INSERT INTO jobs (
         id, job_type, status, progress_current, progress_total, message,
         result_json, error, created_at, started_at, updated_at, finished_at,
         cancel_requested_at, dedupe_key, worker_id
       ) VALUES (?, ?, 'queued', 0, ?, NULL, NULL, NULL, ?, NULL, ?, NULL, NULL, ?, NULL)`,
    ).run(id, opts.jobType, opts.progressTotal ?? null, ts, ts, dedupeKey);
  } catch (err) {
    if (!dedupeKey) throw err;
    const existing = activeByDedupeKey(db, dedupeKey);
    if (existing) return { job: existing, created: false };
    throw err;
  }

  const job = rowById(db, id);
  if (!job) throw new Error(`Failed to create job ${id}`);
  appendJobEvent(id, "info", "created", `${opts.jobType} queued`, undefined, db);
  return { job, created: true };
}

export function getJob(id: string, db?: Db): JobRow | null {
  return rowById(dbOrDefault(db), id);
}

export function listActiveJobs(db?: Db): JobRow[] {
  return dbOrDefault(db)
    .prepare(
      `SELECT * FROM jobs
        WHERE status IN ('queued', 'running')
        ORDER BY created_at ASC`,
    )
    .all() as JobRow[];
}

export function listJobEvents(
  jobId: string,
  opts: { limit?: number; db?: Db } = {},
): JobEventRow[] {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  return dbOrDefault(opts.db)
    .prepare(
      `SELECT * FROM job_events
        WHERE job_id = ?
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(jobId, limit) as JobEventRow[];
}

export function appendJobEvent(
  jobId: string,
  level: JobEventLevel,
  eventType: string,
  message?: string | null,
  data?: unknown,
  db?: Db,
): void {
  dbOrDefault(db)
    .prepare(
      `INSERT INTO job_events (job_id, ts, level, event_type, message, data_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      jobId,
      nowSql(),
      level,
      eventType,
      message ?? null,
      data === undefined ? null : JSON.stringify(data),
    );
}

export function updateJobProgress(
  id: string,
  opts: {
    progressCurrent?: number;
    progressTotal?: number | null;
    message?: string | null;
    db?: Db;
  },
): JobRow | null {
  const db = dbOrDefault(opts.db);
  const current = opts.progressCurrent;
  const total = opts.progressTotal;
  db.prepare(
    `UPDATE jobs
        SET progress_current = COALESCE(?, progress_current),
            progress_total = CASE WHEN ? THEN ? ELSE progress_total END,
            message = COALESCE(?, message),
            updated_at = ?
      WHERE id = ?`,
  ).run(
    current ?? null,
    Object.prototype.hasOwnProperty.call(opts, "progressTotal") ? 1 : 0,
    total ?? null,
    opts.message ?? null,
    nowSql(),
    id,
  );
  return rowById(db, id);
}

export function markJobRunning(
  id: string,
  workerId: string,
  message?: string | null,
  db?: Db,
): JobRow | null {
  const store = dbOrDefault(db);
  const ts = nowSql();
  store
    .prepare(
      `UPDATE jobs
          SET status = 'running', started_at = COALESCE(started_at, ?),
              updated_at = ?, worker_id = ?, message = COALESCE(?, message)
        WHERE id = ? AND status = 'queued'`,
    )
    .run(ts, ts, workerId, message ?? null, id);
  return rowById(store, id);
}

export function markJobSucceeded(
  id: string,
  result: unknown,
  message?: string | null,
  db?: Db,
): JobRow | null {
  const store = dbOrDefault(db);
  const ts = nowSql();
  store
    .prepare(
      `UPDATE jobs
          SET status = 'succeeded', result_json = ?, error = NULL,
              message = COALESCE(?, message), updated_at = ?, finished_at = ?
        WHERE id = ?`,
    )
    .run(JSON.stringify(result), message ?? null, ts, ts, id);
  return rowById(store, id);
}

export function markJobFailed(
  id: string,
  error: unknown,
  db?: Db,
): JobRow | null {
  const store = dbOrDefault(db);
  const ts = nowSql();
  const message = error instanceof Error ? error.message : String(error);
  store
    .prepare(
      `UPDATE jobs
          SET status = 'failed', error = ?, message = ?, updated_at = ?, finished_at = ?
        WHERE id = ?`,
    )
    .run(message, message, ts, ts, id);
  return rowById(store, id);
}

export function markJobCancelled(
  id: string,
  result: unknown,
  message = "Cancelled",
  db?: Db,
): JobRow | null {
  const store = dbOrDefault(db);
  const ts = nowSql();
  store
    .prepare(
      `UPDATE jobs
          SET status = 'cancelled', result_json = ?, message = ?, updated_at = ?, finished_at = ?
        WHERE id = ?`,
    )
    .run(JSON.stringify(result), message, ts, ts, id);
  return rowById(store, id);
}

export function requestJobCancel(id: string, db?: Db): JobRow | null {
  const store = dbOrDefault(db);
  const ts = nowSql();
  store
    .prepare(
      `UPDATE jobs
          SET cancel_requested_at = COALESCE(cancel_requested_at, ?), updated_at = ?
        WHERE id = ?`,
    )
    .run(ts, ts, id);
  return rowById(store, id);
}

export function isJobCancelRequested(id: string, db?: Db): boolean {
  const row = rowById(dbOrDefault(db), id);
  return Boolean(row?.cancel_requested_at);
}
