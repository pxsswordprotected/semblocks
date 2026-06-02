import {
  appendJobEvent,
  getJob,
  isJobCancelRequested,
  markJobCancelled,
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  updateJobProgress,
} from "./jobs.ts";
import { parseUserSlug } from "./arena.ts";
import { ingestUser } from "./ingest.ts";
import { ocrPendingImages } from "./ocr.ts";
import { extractPendingExternalContent } from "./external-content.ts";
import { extractPendingTranscripts } from "./transcripts.ts";
import { processChunks } from "./chunks.ts";
import { embedPendingBlocks } from "./embed-blocks.ts";
import type { FullSyncResult } from "./full-sync.ts";
import type { JobRow } from "./job-types.ts";

const inFlight = new Set<string>();

class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled");
    this.name = "JobCancelledError";
  }
}

function workerId(): string {
  return `${process.pid}:${Date.now().toString(36)}`;
}

function parseSyncUser(job: JobRow): string {
  const prefix = "sync_full:";
  if (!job.dedupe_key?.startsWith(prefix)) {
    throw new Error("sync_full job is missing user scope");
  }
  return parseUserSlug(job.dedupe_key.slice(prefix.length));
}

function ocrLimit(job: JobRow): number {
  return Math.max(1, Math.min(500, job.progress_total ?? 500));
}

async function throwIfCancelled(jobId: string): Promise<void> {
  if (isJobCancelRequested(jobId)) throw new JobCancelledError();
}

async function runStage<T>(
  jobId: string,
  stageIndex: number,
  stageName: string,
  run: () => Promise<T>,
): Promise<T> {
  await throwIfCancelled(jobId);
  updateJobProgress(jobId, {
    progressCurrent: stageIndex,
    message: `${stageName} running`,
  });
  appendJobEvent(jobId, "info", "stage_started", `${stageName} started`, {
    stage: stageName,
  });
  const result = await run();
  updateJobProgress(jobId, {
    progressCurrent: stageIndex + 1,
    message: `${stageName} complete`,
  });
  appendJobEvent(jobId, "info", "stage_finished", `${stageName} complete`, {
    stage: stageName,
    result,
  });
  return result;
}

async function runOcrJob(job: JobRow) {
  const limit = ocrLimit(job);
  updateJobProgress(job.id, {
    progressTotal: limit,
    message: `OCR queued for up to ${limit} images`,
  });
  const result = await ocrPendingImages({
    limit,
    rebuild: false,
    shouldCancel: () => isJobCancelRequested(job.id),
    onProgress: (progress) => {
      updateJobProgress(job.id, {
        progressCurrent: progress.completed,
        progressTotal: progress.total,
        message: `OCR ${progress.completed}/${progress.total} processed=${progress.processed} errors=${progress.errors}`,
      });
    },
  });

  if (isJobCancelRequested(job.id)) {
    markJobCancelled(job.id, result, "OCR cancelled");
    appendJobEvent(job.id, "warn", "cancelled", "OCR cancelled", result);
    return;
  }

  markJobSucceeded(
    job.id,
    result,
    `OCR complete processed=${result.processed} errors=${result.errors}`,
  );
  appendJobEvent(job.id, "info", "finished", "OCR complete", result);
}

async function runFullSyncJob(job: JobRow) {
  const username = parseSyncUser(job);
  updateJobProgress(job.id, {
    progressCurrent: 0,
    progressTotal: 6,
    message: `Sync starting for ${username}`,
  });

  const ingest = await runStage(job.id, 0, "Ingest", () => ingestUser(username));
  const ocr = await runStage(job.id, 1, "OCR", () =>
    ocrPendingImages({
      limit: 500,
      rebuild: false,
      shouldCancel: () => isJobCancelRequested(job.id),
      onProgress: (progress) => {
        updateJobProgress(job.id, {
          progressCurrent: 1,
          progressTotal: 6,
          message: `OCR ${progress.completed}/${progress.total} processed=${progress.processed} errors=${progress.errors}`,
        });
      },
    }),
  );
  const externalContent = await runStage(job.id, 2, "External content", () =>
    extractPendingExternalContent({ rebuild: false }),
  );
  const transcripts = await runStage(job.id, 3, "Transcripts", () =>
    extractPendingTranscripts({ rebuild: false }),
  );
  const chunks = await runStage(job.id, 4, "Chunks", () =>
    processChunks({ rebuild: false }),
  );
  const embeddings = await runStage(job.id, 5, "Embeddings", () =>
    embedPendingBlocks({ rebuild: false }),
  );

  if (isJobCancelRequested(job.id)) {
    const partial = { profile: { username }, ingest, ocr, external_content: externalContent, transcripts, chunks, embeddings };
    markJobCancelled(job.id, partial, "Sync cancelled");
    appendJobEvent(job.id, "warn", "cancelled", "Sync cancelled", partial);
    return;
  }

  const result: FullSyncResult = {
    profile: { username },
    ingest,
    ocr,
    external_content: externalContent,
    transcripts,
    chunks,
    embeddings,
  };
  markJobSucceeded(job.id, result, `Sync complete for ${username}`);
  appendJobEvent(job.id, "info", "finished", "Sync complete", result);
}

async function runJob(jobId: string): Promise<void> {
  const initial = getJob(jobId);
  if (!initial) throw new Error(`Job not found: ${jobId}`);
  if (!["queued", "running"].includes(initial.status)) return;

  inFlight.add(jobId);
  try {
    const running =
      initial.status === "queued"
        ? markJobRunning(jobId, workerId(), "Starting")
        : initial;
    if (!running) throw new Error(`Job not found: ${jobId}`);
    appendJobEvent(jobId, "info", "claimed", "Job runner started");

    if (isJobCancelRequested(jobId)) throw new JobCancelledError();

    if (running.job_type === "ocr") await runOcrJob(running);
    else if (running.job_type === "sync_full") await runFullSyncJob(running);
    else throw new Error(`Unsupported job type: ${running.job_type}`);
  } catch (err) {
    if (err instanceof JobCancelledError || isJobCancelRequested(jobId)) {
      markJobCancelled(jobId, null, "Cancelled");
      appendJobEvent(jobId, "warn", "cancelled", "Job cancelled");
    } else {
      markJobFailed(jobId, err);
      appendJobEvent(
        jobId,
        "error",
        "failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  } finally {
    inFlight.delete(jobId);
  }
}

export function startJob(jobId: string): boolean {
  if (inFlight.has(jobId)) return false;
  void runJob(jobId).catch((err) => {
    markJobFailed(jobId, err);
    appendJobEvent(
      jobId,
      "error",
      "failed",
      err instanceof Error ? err.message : String(err),
    );
    inFlight.delete(jobId);
  });
  return true;
}
