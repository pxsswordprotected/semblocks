import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  appendJobEvent,
  createJob,
  getJob,
  isJobCancelRequested,
  listActiveJobs,
  listJobEvents,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  requestJobCancel,
  updateJobProgress,
} from "./jobs.ts";

function createJobsDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
      progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= 0),
      message TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      cancel_requested_at TEXT,
      dedupe_key TEXT,
      worker_id TEXT
    );
    CREATE UNIQUE INDEX jobs_dedupe_active
      ON jobs(dedupe_key)
      WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
    CREATE TABLE job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
      event_type TEXT NOT NULL,
      message TEXT,
      data_json TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
  `);
  return db;
}

test("createJob dedupes active jobs by dedupe key", () => {
  const db = createJobsDb();
  try {
    const first = createJob({ jobType: "ocr", dedupeKey: "ocr", db });
    const second = createJob({ jobType: "ocr", dedupeKey: "ocr", db });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.job.id, first.job.id);
    assert.equal(listActiveJobs(db).length, 1);
  } finally {
    db.close();
  }
});

test("completed jobs release dedupe key for future work", () => {
  const db = createJobsDb();
  try {
    const first = createJob({ jobType: "ocr", dedupeKey: "ocr", db });
    markJobSucceeded(first.job.id, { processed: 1 }, "done", db);

    const second = createJob({ jobType: "ocr", dedupeKey: "ocr", db });
    assert.equal(second.created, true);
    assert.notEqual(second.job.id, first.job.id);
    assert.equal(listActiveJobs(db).length, 1);
  } finally {
    db.close();
  }
});

test("job status helpers update progress, events, cancel and failure", () => {
  const db = createJobsDb();
  try {
    const { job } = createJob({ jobType: "sync_full", dedupeKey: "sync_full:user", progressTotal: 6, db });

    const running = markJobRunning(job.id, "worker-1", "running", db);
    assert.equal(running?.status, "running");
    assert.equal(running?.worker_id, "worker-1");

    const progressed = updateJobProgress(job.id, {
      progressCurrent: 3,
      progressTotal: 6,
      message: "halfway",
      db,
    });
    assert.equal(progressed?.progress_current, 3);
    assert.equal(progressed?.progress_total, 6);
    assert.equal(progressed?.message, "halfway");

    appendJobEvent(job.id, "info", "progress", "halfway", { current: 3 }, db);
    const events = listJobEvents(job.id, { db });
    assert.equal(events[0]?.event_type, "progress");
    assert.equal(events[0]?.message, "halfway");

    assert.equal(isJobCancelRequested(job.id, db), false);
    const cancelRequested = requestJobCancel(job.id, db);
    assert.ok(cancelRequested?.cancel_requested_at);
    assert.equal(isJobCancelRequested(job.id, db), true);

    const failed = markJobFailed(job.id, new Error("boom"), db);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.error, "boom");
    assert.ok(getJob(job.id, db)?.finished_at);
  } finally {
    db.close();
  }
});
