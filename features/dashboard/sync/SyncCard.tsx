"use client";

import { useEffect, useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/dashboard/panel";
import type { DashboardProfileConfig } from "@/lib/profile-config";
import type { FullSyncResult } from "@/lib/full-sync";
import type { JobEventRow, JobRow } from "@/lib/job-types";

type JobResponse = {
  job: JobRow;
  events: JobEventRow[];
};

type SyncStatus =
  | { state: "idle" }
  | { state: "running"; jobId: string; job: JobRow | null }
  | { state: "success"; job: JobRow; result: FullSyncResult | null }
  | { state: "cancelled"; job: JobRow }
  | { state: "error"; message: string };

export function SyncCard({
  className,
  ownerMode = false,
  profileConfig,
}: {
  className?: string;
  ownerMode?: boolean;
  profileConfig: DashboardProfileConfig | null;
}) {
  const [status, setStatus] = useState<SyncStatus>({ state: "idle" });
  const running = status.state === "running";
  const syncProfileTarget = profileConfig?.sync_profile ?? null;
  const disabled = !ownerMode || running || !syncProfileTarget;

  useEffect(() => {
    if (status.state !== "running" || !status.jobId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(status.jobId)}`);
        const body = (await res.json()) as JobResponse | { error?: string };
        if (!res.ok) {
          throw new Error(
            "error" in body && body.error
              ? body.error
              : `Job status failed (${res.status})`,
          );
        }
        const job = (body as JobResponse).job;
        if (cancelled) return;
        if (job.status === "succeeded") {
          setStatus({
            state: "success",
            job,
            result: parseFullSyncResult(job.result_json),
          });
        } else if (job.status === "failed") {
          setStatus({ state: "error", message: job.error ?? "Sync failed" });
        } else if (job.status === "cancelled") {
          setStatus({ state: "cancelled", job });
        } else {
          setStatus({ state: "running", jobId: status.jobId, job });
        }
      } catch (err) {
        if (cancelled) return;
        setStatus({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [status]);

  async function syncProfile() {
    if (disabled || !syncProfileTarget) return;
    setStatus({ state: "running", jobId: "", job: null });

    try {
      const res = await fetch(
        `/api/jobs/sync?user=${encodeURIComponent(syncProfileTarget.username)}`,
        { method: "POST" },
      );
      const body = (await res.json()) as { job_id?: string; error?: string };
      if (!res.ok || body.error || !body.job_id) {
        throw new Error(body.error ?? `Sync failed (${res.status})`);
      }
      setStatus({ state: "running", jobId: body.job_id, job: null });
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <Panel className={className}>
      <button
        type="button"
        disabled={disabled}
        onClick={syncProfile}
        className="flex h-full w-full min-w-0 flex-col justify-center items-center gap-1.5 overflow-hidden px-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex max-w-full items-center gap-1.5 whitespace-nowrap text-[16px] text-neutral-800">
          <ArrowsClockwise size={26} className="shrink-0" />
          {running ? "Syncing…" : "Sync new blocks"}
        </span>
        <span className="block max-w-full truncate text-sm text-black/50">
          {profileConfig === null
            ? "Loading profile…"
            : !syncProfileTarget
              ? "Set ARENA_PROFILE_SLUG"
              : ownerMode
                ? `Current profile: ${syncProfileTarget.username}`
                : "Sync available in owner mode"}
        </span>
        <SyncSummary status={status} />
      </button>
    </Panel>
  );
}

function parseFullSyncResult(raw: string | null): FullSyncResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FullSyncResult;
  } catch {
    return null;
  }
}

function progressText(job: JobRow | null): string {
  if (!job) return "Starting sync job…";
  const total = job.progress_total;
  const prefix =
    total && total > 0
      ? `${job.progress_current}/${total}`
      : `${job.progress_current}`;
  return `${job.message ?? job.status} (${prefix})`;
}

function SyncSummary({ status }: { status: SyncStatus }) {
  if (status.state === "idle") return null;
  if (status.state === "running") {
    return (
      <span className="block max-w-full truncate text-center text-xs leading-snug text-black/50">
        {progressText(status.job)}
      </span>
    );
  }
  if (status.state === "error") {
    return <span className="block max-w-full truncate text-xs text-red-600">{status.message}</span>;
  }
  if (status.state === "cancelled") {
    return <span className="block max-w-full truncate text-xs text-black/50">Sync cancelled.</span>;
  }

  const r = status.result;
  if (!r) {
    return (
      <span className="block max-w-full truncate text-center text-xs leading-snug text-black/60">
        {status.job.message ?? "Sync complete."}
      </span>
    );
  }
  return (
    <span className="block max-w-full truncate text-center text-xs leading-snug text-black/60">
      Saved {r.ingest.channel_count} channels, {r.ingest.block_count} blocks,{" "}
      {r.ingest.link_count} links · OCR {r.ocr.processed}/{r.ocr.errors} ·
      Content {r.external_content.processed}/{r.external_content.errors}/
      {r.external_content.skipped} · Transcripts {r.transcripts.processed}/
      {r.transcripts.errors}/{r.transcripts.skipped} · Chunks {r.chunks.chunked}/
      {r.chunks.embedded}/{r.chunks.skipped} · Embeddings {r.embeddings.embedded}/
      {r.embeddings.skipped}
    </span>
  );
}
