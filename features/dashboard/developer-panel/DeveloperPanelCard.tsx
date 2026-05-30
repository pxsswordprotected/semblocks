"use client";

import { CaretDown, CaretUp } from "@phosphor-icons/react/dist/ssr";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Button from "@/components/Button";
import { Panel } from "@/components/dashboard/panel";
import type { DevStatusLog, DevStatusResponse } from "@/lib/dev-status";
import { cn } from "@/lib/utils";

type DeveloperPanelCardProps = {
  className?: string;
  ownerMode?: boolean;
};

type SectionId = "index" | "enrichment" | "actions" | "debug";

type ActionId =
  | "pipeline"
  | "sync"
  | "embed"
  | "ocr"
  | "external-content"
  | "transcripts"
  | "chunks";

type ActionMessage = {
  kind: "success" | "error";
  text: string;
};

type ApiError = {
  error?: string;
};

const SECTIONS: readonly { id: SectionId; title: string }[] = [
  { id: "index", title: "Index Status" },
  { id: "enrichment", title: "Enrichment" },
  { id: "actions", title: "Actions" },
  { id: "debug", title: "Debug" },
];

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

export function DeveloperPanelCard({
  className,
  ownerMode = false,
}: DeveloperPanelCardProps) {
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    () => new Set(["index"]),
  );
  const [status, setStatus] = useState<DevStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<ActionId | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(
    null,
  );

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    setStatusLoading(true);
    setStatusError(null);

    try {
      const res = await fetch("/api/dev/status", { signal });
      const body = (await res.json()) as DevStatusResponse | ApiError;
      const apiError = isApiError(body) ? body.error : null;
      if (!res.ok || apiError) {
        throw new Error(apiError ?? `HTTP ${res.status}`);
      }
      setStatus(body as DevStatusResponse);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatusError(getErrorMessage(err));
    } finally {
      if (!signal?.aborted) setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  const ingestUser = status?.profile?.username ?? null;
  const actionLocked = !ownerMode || Boolean(busyAction);
  const syncLocked = actionLocked || !ingestUser;

  function toggleSection(id: SectionId) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function postAction(endpoint: string) {
    const res = await fetch(endpoint, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as ApiError;
    if (!res.ok || body.error) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
  }

  async function runAction(
    id: ActionId,
    label: string,
    endpoints: readonly string[],
  ) {
    if (!ownerMode || busyAction || endpoints.length === 0) return;

    setBusyAction(id);
    setActionMessage(null);

    try {
      for (const endpoint of endpoints) {
        await postAction(endpoint);
      }
      await loadStatus();
      setActionMessage({ kind: "success", text: `${label} completed.` });
    } catch (err) {
      setActionMessage({ kind: "error", text: getErrorMessage(err) });
    } finally {
      setBusyAction(null);
    }
  }

  function runSync() {
    if (!ingestUser) return;
    void runAction("sync", "Sync Are.na", [ingestEndpoint(ingestUser)]);
  }

  function runPipeline() {
    if (!ingestUser) return;
    void runAction("pipeline", "Run full pipeline", [
      ingestEndpoint(ingestUser),
      "/api/ocr",
      "/api/external-content",
      "/api/transcripts",
      "/api/chunks",
      "/api/embed",
    ]);
  }

  function renderSection(id: SectionId): ReactNode {
    switch (id) {
      case "index":
        return (
          <IndexStatusSection
            status={status}
            statusError={statusError}
            statusLoading={statusLoading}
            onRetry={() => void loadStatus()}
          />
        );
      case "enrichment":
        return (
          <EnrichmentSection
            status={status}
            statusError={statusError}
            statusLoading={statusLoading}
            onRetry={() => void loadStatus()}
          />
        );
      case "actions":
        return (
          <ActionsSection
            ownerMode={ownerMode}
            ingestUser={ingestUser}
            busyAction={busyAction}
            actionMessage={actionMessage}
            actionLocked={actionLocked}
            syncLocked={syncLocked}
            onRunPipeline={runPipeline}
            onRunSync={runSync}
            onRunEmbed={() => void runAction("embed", "Embed missing", ["/api/embed"])}
            onRunOcr={() => void runAction("ocr", "OCR images", ["/api/ocr"])}
            onRunExternalContent={() =>
              void runAction("external-content", "Read content", [
                "/api/external-content",
              ])
            }
            onRunTranscripts={() =>
              void runAction("transcripts", "Read transcripts", [
                "/api/transcripts",
              ])
            }
            onRunChunks={() =>
              void runAction("chunks", "Process chunks", ["/api/chunks"])
            }
          />
        );
      case "debug":
        return <DebugSection logs={status?.logs ?? []} />;
    }
  }

  return (
    <Panel className={cn("flex min-h-0 flex-col overflow-hidden py-3", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col gap-2">
          {SECTIONS.map((section) => {
            const open = openSections.has(section.id);
            const Icon = open ? CaretUp : CaretDown;
            return (
              <div
                key={section.id}
                className="overflow-hidden rounded-base border border-stroke bg-white/20"
              >
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <h2 className="text-sm leading-5 font-bold text-neutral-800">
                    {section.title}
                  </h2>
                  <Button
                    type="button"
                    variant="muted"
                    aria-expanded={open}
                    aria-controls={`developer-panel-${section.id}`}
                    aria-label={`${open ? "Collapse" : "Expand"} ${section.title}`}
                    onClick={() => toggleSection(section.id)}
                    className="h-7 min-w-7 shrink-0 px-1.5 py-0"
                  >
                    <Icon size={14} weight="bold" />
                  </Button>
                </div>
                {open ? (
                  <div
                    id={`developer-panel-${section.id}`}
                    className="border-t border-stroke px-3 py-3"
                  >
                    {renderSection(section.id)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function IndexStatusSection({
  status,
  statusError,
  statusLoading,
  onRetry,
}: {
  status: DevStatusResponse | null;
  statusError: string | null;
  statusLoading: boolean;
  onRetry: () => void;
}) {
  if (!status) {
    return <StatusPlaceholder error={statusError} loading={statusLoading} onRetry={onRetry} />;
  }

  const profileLabel = status.profile
    ? status.profile.name
      ? `${status.profile.name} (${status.profile.username ?? "unknown"})`
      : status.profile.username ?? "Indexed profile"
    : "No indexed profile";
  const lastSync = status.last_sync;
  const counts = status.counts;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <StatRow label="Profile" value={profileLabel} />
      <StatRow
        label="Last sync"
        value={lastSync ? syncLabel(lastSync) : "No sync logs"}
      />
      <StatRow label="Channels" value={formatCount(counts.channels)} />
      <StatRow label="Blocks" value={formatCount(counts.blocks)} />
      <StatRow
        label="Embeddings"
        value={`${formatCount(counts.embeddings)} / ${formatCount(counts.embeddable_blocks)}`}
      />
      <StatRow
        label="Missing embeddings"
        value={formatCount(counts.missing_embeddings)}
        urgent={counts.missing_embeddings > 0}
      />
    </div>
  );
}

function EnrichmentSection({
  status,
  statusError,
  statusLoading,
  onRetry,
}: {
  status: DevStatusResponse | null;
  statusError: string | null;
  statusLoading: boolean;
  onRetry: () => void;
}) {
  if (!status) {
    return <StatusPlaceholder error={statusError} loading={statusLoading} onRetry={onRetry} />;
  }

  const counts = status.counts;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <StatRow
        label="OCR rows / errors"
        value={`${formatCount(counts.ocr_rows)} / ${formatCount(counts.ocr_errors)}`}
        urgent={counts.ocr_errors > 0}
      />
      <StatRow
        label="External rows / errors"
        value={`${formatCount(counts.external_content_rows)} / ${formatCount(counts.external_content_errors)}`}
        urgent={counts.external_content_errors > 0}
      />
      <StatRow
        label="Transcript rows / errors"
        value={`${formatCount(counts.transcript_rows)} / ${formatCount(counts.transcript_errors)}`}
        urgent={counts.transcript_errors > 0}
      />
      <StatRow label="Chunks" value={formatCount(counts.chunks)} />
      <StatRow
        label="Chunk embeddings"
        value={formatCount(counts.chunk_embeddings)}
      />
      <NeedAction label="OCR errors" count={counts.ocr_errors} />
      <NeedAction
        label="External content errors"
        count={counts.external_content_errors}
      />
      <NeedAction label="Transcript errors" count={counts.transcript_errors} />
    </div>
  );
}

function ActionsSection({
  ownerMode,
  ingestUser,
  busyAction,
  actionMessage,
  actionLocked,
  syncLocked,
  onRunPipeline,
  onRunSync,
  onRunEmbed,
  onRunOcr,
  onRunExternalContent,
  onRunTranscripts,
  onRunChunks,
}: {
  ownerMode: boolean;
  ingestUser: string | null;
  busyAction: ActionId | null;
  actionMessage: ActionMessage | null;
  actionLocked: boolean;
  syncLocked: boolean;
  onRunPipeline: () => void;
  onRunSync: () => void;
  onRunEmbed: () => void;
  onRunOcr: () => void;
  onRunExternalContent: () => void;
  onRunTranscripts: () => void;
  onRunChunks: () => void;
}) {
  const disabledCopy = !ownerMode
    ? "Public mode. Log in at /dev to enable actions."
    : !ingestUser
      ? "No indexed profile. Sync and full pipeline need an Are.na username."
      : null;

  return (
    <div className="flex flex-col gap-3">
      {disabledCopy ? (
        <p className="text-xs leading-4 text-black/50">{disabledCopy}</p>
      ) : null}

      <Button
        type="button"
        disabled={syncLocked}
        onClick={onRunPipeline}
        className="w-full px-3 py-2"
      >
        {busyAction === "pipeline" ? "Running pipeline…" : "Run full pipeline"}
      </Button>

      <div className="grid grid-cols-1 gap-2">
        <ActionButton
          disabled={syncLocked}
          busy={busyAction === "sync"}
          label="Sync Are.na"
          busyLabel="Syncing…"
          onClick={onRunSync}
        />
        <ActionButton
          disabled={actionLocked}
          busy={busyAction === "embed"}
          label="Embed missing"
          busyLabel="Embedding…"
          onClick={onRunEmbed}
        />
        <ActionButton
          disabled={actionLocked}
          busy={busyAction === "ocr"}
          label="OCR images"
          busyLabel="Reading images…"
          onClick={onRunOcr}
        />
        <ActionButton
          disabled={actionLocked}
          busy={busyAction === "external-content"}
          label="Read content"
          busyLabel="Reading content…"
          onClick={onRunExternalContent}
        />
        <ActionButton
          disabled={actionLocked}
          busy={busyAction === "transcripts"}
          label="Read transcripts"
          busyLabel="Reading transcripts…"
          onClick={onRunTranscripts}
        />
        <ActionButton
          disabled={actionLocked}
          busy={busyAction === "chunks"}
          label="Process chunks"
          busyLabel="Processing chunks…"
          onClick={onRunChunks}
        />
      </div>

      {actionMessage ? (
        <p
          className={cn(
            "rounded-base border border-stroke bg-white/25 px-2 py-1.5 text-xs leading-4",
            actionMessage.kind === "error" ? "text-error" : "text-black/60",
          )}
        >
          {actionMessage.text}
        </p>
      ) : null}
    </div>
  );
}

function DebugSection({ logs }: { logs: readonly DevStatusLog[] }) {
  const failedLogs = logs.filter((log) => log.status !== "ok");

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <h3 className="mb-1 text-xs font-bold tracking-wide text-black/50 uppercase">
          Failed sync logs
        </h3>
        <LogList logs={failedLogs} empty="No failed sync logs." />
      </div>
      <div>
        <h3 className="mb-1 text-xs font-bold tracking-wide text-black/50 uppercase">
          Recent sync logs
        </h3>
        <LogList logs={logs} empty="No sync logs." />
      </div>
      <p className="rounded-base border border-stroke bg-white/25 px-2 py-1.5 text-xs leading-4 text-black/50">
        Advanced rebuild tools hidden.
      </p>
    </div>
  );
}

function ActionButton({
  disabled,
  busy,
  label,
  busyLabel,
  onClick,
}: {
  disabled: boolean;
  busy: boolean;
  label: string;
  busyLabel: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="muted"
      disabled={disabled}
      onClick={onClick}
      className="w-full justify-start px-3 py-2 text-left"
    >
      {busy ? busyLabel : label}
    </Button>
  );
}

function StatRow({
  label,
  value,
  urgent = false,
}: {
  label: string;
  value: string;
  urgent?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-stroke/60 pb-1 last:border-b-0 last:pb-0">
      <span className="text-black/50">{label}</span>
      <span
        className={cn(
          "text-right font-bold text-neutral-800",
          urgent && "text-error",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function NeedAction({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-base border border-stroke bg-white/25 px-2 py-1.5 text-xs leading-4 text-black/60">
      {label}: <span className={cn("font-bold", count > 0 && "text-error")}>{formatCount(count)}</span>
    </div>
  );
}

function StatusPlaceholder({
  error,
  loading,
  onRetry,
}: {
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="text-sm leading-5 text-error">
        Couldn&apos;t load status: {error}.{" "}
        <button type="button" onClick={onRetry} className="underline">
          retry
        </button>
      </div>
    );
  }

  return (
    <p className="text-sm leading-5 text-black/50">
      {loading ? "Loading status…" : "No status loaded."}
    </p>
  );
}

function LogList({
  logs,
  empty,
}: {
  logs: readonly DevStatusLog[];
  empty: string;
}) {
  if (logs.length === 0) {
    return <p className="text-xs leading-4 text-black/50">{empty}</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {logs.slice(0, 5).map((log) => (
        <div
          key={log.id}
          className="rounded-base border border-stroke bg-white/25 px-2 py-1.5"
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <span
              className={cn(
                "font-bold",
                log.status === "ok" ? "text-neutral-800" : "text-error",
              )}
            >
              {log.status ?? "unknown"}
            </span>
            <span className="text-right text-black/50">
              {log.created_at ?? "no date"}
            </span>
          </div>
          {log.message ? (
            <p className="mt-1 line-clamp-2 text-xs leading-4 text-black/60">
              {log.message}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function syncLabel(sync: { status: string | null; created_at: string | null }) {
  if (sync.status && sync.created_at) return `${sync.status} · ${sync.created_at}`;
  return sync.status ?? sync.created_at ?? "unknown";
}

function formatCount(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

function ingestEndpoint(user: string): string {
  return `/api/arena/ingest?user=${encodeURIComponent(user)}`;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isApiError(body: DevStatusResponse | ApiError): body is ApiError {
  return "error" in body;
}
