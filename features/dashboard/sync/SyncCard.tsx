"use client";

import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/dashboard/panel";
import { PROFILE_USERNAME } from "@/features/dashboard/profile/profile";
import type { FullSyncResult } from "@/lib/full-sync";

type SyncStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "success"; result: FullSyncResult }
  | { state: "error"; message: string };

export function SyncCard({
  className,
  ownerMode = false,
}: {
  className?: string;
  ownerMode?: boolean;
}) {
  const [status, setStatus] = useState<SyncStatus>({ state: "idle" });
  const running = status.state === "running";
  const disabled = !ownerMode || running;

  async function syncProfile() {
    if (disabled) return;
    setStatus({ state: "running" });

    try {
      const res = await fetch(
        `/api/sync?user=${encodeURIComponent(PROFILE_USERNAME)}`,
        { method: "POST" },
      );
      const body = (await res.json()) as FullSyncResult | { error?: string };
      if (!res.ok) {
        throw new Error(
          "error" in body && body.error ? body.error : `Sync failed (${res.status})`,
        );
      }
      setStatus({ state: "success", result: body as FullSyncResult });
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
        className="flex h-full w-full flex-col justify-center items-center gap-1.5 px-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex items-center gap-1.5 text-[16px] text-neutral-800">
          <ArrowsClockwise size={26} />
          {running ? "Syncing…" : "Sync new blocks"}
        </span>
        <span className="text-sm text-black/50">
          {ownerMode
            ? `Current profile: ${PROFILE_USERNAME}`
            : "Sync available in owner mode"}
        </span>
        <SyncSummary status={status} />
      </button>
    </Panel>
  );
}

function SyncSummary({ status }: { status: SyncStatus }) {
  if (status.state === "idle") return null;
  if (status.state === "running") {
    return <span className="text-xs text-black/50">Running full sync pipeline…</span>;
  }
  if (status.state === "error") {
    return <span className="text-xs text-red-600">{status.message}</span>;
  }

  const r = status.result;
  return (
    <span className="text-center text-xs leading-snug text-black/60">
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
