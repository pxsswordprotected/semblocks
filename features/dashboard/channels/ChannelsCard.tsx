"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import {
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import Button from "@/components/Button";
import { Panel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";
import type { ChannelSummary } from "./types";

type IndexedChannel = ChannelSummary & {
  slug: string | null;
  url: string | null;
};

type ChannelsResponse = {
  channels: IndexedChannel[];
  total_block_count: number;
};


type ChannelsCardProps = {
  className?: string;
  onSelectionChange?: (channels: ChannelSummary[]) => void;
};

const CHANNELS_PER_PAGE = 8;

const SELECTED_ROW_STYLE = {
  backgroundColor: "#141414",
  boxShadow: [
    "0 1px 1.7px rgb(0 0 0 / 0.19)",
    "inset 0 0 0 1px rgb(0 0 0 / 0.10)",
    "inset -1px -1px 3.6px rgb(245 245 245 / 0.82)",
    "inset 0 0 7.6px rgb(255 255 255 / 0.40)",
  ].join(", "),
} satisfies CSSProperties;

export function ChannelsCard(props: ChannelsCardProps) {
  return (
    <Suspense fallback={<ChannelsCardFallback className={props.className} />}>
      <ChannelsCardInner {...props} />
    </Suspense>
  );
}

function ChannelsCardFallback({ className }: { className?: string }) {
  return (
    <Panel className={cn("flex flex-col py-4", className)}>
      <h2 className="px-6 text-xl leading-5 font-bold text-neutral-800">
        Channels
      </h2>
      <div className="mt-4 h-px shrink-0 bg-stroke" />
      <div className="mt-4 flex min-h-0 flex-1 flex-col justify-evenly px-6">
        <p className="text-sm text-black/50">Loading channels…</p>
      </div>
      <div className="mt-4 h-px shrink-0 bg-stroke" />
      <div className="mt-4 flex h-5 items-center justify-between gap-3 px-6 text-sm text-black/50" />
    </Panel>
  );
}

function ChannelsCardInner({
  className,
  onSelectionChange,
}: ChannelsCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const channelsParam = searchParams.get("channels");
  const [, startTransition] = useTransition();
  const [channels, setChannels] = useState<IndexedChannel[] | null>(null);
  const [totalBlockCount, setTotalBlockCount] = useState(0);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<number>>(
    () => parseChannelIds(channelsParam),
  );
  const [page, setPage] = useState(0);

  async function loadChannels() {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const res = await fetch("/api/channels");
      const body = (await res.json()) as ChannelsResponse | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setChannels(body.channels);
      setTotalBlockCount(body.total_block_count);
      setPage(0);
    } catch (err) {
      setChannelsError(err instanceof Error ? err.message : String(err));
    } finally {
      setChannelsLoading(false);
    }
  }

  useEffect(() => {
    void loadChannels();
  }, []);

  useEffect(() => {
    const next = normalizeSelectedIds(
      sanitizeChannelIds(parseChannelIds(channelsParam), channels),
      channels,
    );
    setSelectedChannelIds((prev) => (setsEqual(prev, next) ? prev : next));
  }, [channels, channelsParam]);

  const totalChannels = channels?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalChannels / CHANNELS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleChannels = useMemo(() => {
    if (!channels) return [];
    const start = safePage * CHANNELS_PER_PAGE;
    return channels.slice(start, start + CHANNELS_PER_PAGE);
  }, [channels, safePage]);
  const totalBlocks = totalBlockCount;
  const selectedChannels = useMemo<ChannelSummary[]>(() => {
    if (!channels || selectedChannelIds.size === 0) return [];
    return channels
      .filter((channel) => selectedChannelIds.has(channel.id))
      .map(({ id, title, block_count }) => ({ id, title, block_count }));
  }, [channels, selectedChannelIds]);

  useEffect(() => {
    if (!channels) return;
    onSelectionChange?.(selectedChannels);
  }, [channels, onSelectionChange, selectedChannels]);

  const showingStart =
    totalChannels === 0 ? 0 : safePage * CHANNELS_PER_PAGE + 1;
  const showingEnd = Math.min(
    totalChannels,
    (safePage + 1) * CHANNELS_PER_PAGE,
  );

  const rowSlotCount = CHANNELS_PER_PAGE + 1;

  function replaceSelectedChannels(ids: Set<number>) {
    const next = normalizeSelectedIds(ids, channels);
    setSelectedChannelIds(next);
    const href = setChannelParams(searchParams, next);
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  function onToggleChannel(id: number) {
    const next = new Set(selectedChannelIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    replaceSelectedChannels(next);
  }

  function onClearChannels() {
    replaceSelectedChannels(new Set());
  }

  return (
    <Panel className={cn("flex flex-col py-4", className)}>
      <h2 className="px-6 text-base leading-5 font-bold text-neutral-800">
        Channels
      </h2>

      <div className="mt-4 h-px shrink-0 bg-stroke" />

      <div className="mt-4 flex min-h-0 flex-1 flex-col justify-evenly px-6">
        {channelsError ? (
          <div className="text-sm text-error">
            Couldn&apos;t load channels: {channelsError}.{" "}
            <button type="button" onClick={loadChannels} className="underline">
              retry
            </button>
          </div>
        ) : channelsLoading && channels === null ? (
          <p className="text-sm text-black/50">Loading channels…</p>
        ) : channels !== null && channels.length === 0 ? (
          <p className="text-sm text-black/50">
            No channels indexed yet. Run Save above first.
          </p>
        ) : (
          Array.from({ length: rowSlotCount }, (_, i) => {
            if (i === 0) {
              return (
                <ChannelRow
                  key="all"
                  label="All channels"
                  count={totalBlocks}
                  selected={selectedChannelIds.size === 0}
                  onClick={onClearChannels}
                />
              );
            }

            const channel = visibleChannels[i - 1];
            if (!channel) return <ChannelRowPlaceholder key={`empty-${i}`} />;

            const disabled = channel.block_count === 0;
            return (
              <ChannelRow
                key={channel.id}
                label={channel.title ?? "(untitled)"}
                count={channel.block_count}
                selected={selectedChannelIds.has(channel.id)}
                disabled={disabled}
                onClick={() => {
                  if (!disabled) onToggleChannel(channel.id);
                }}
              />
            );
          })
        )}
      </div>

      <div className="h-px shrink-0 bg-stroke" />

      <div className="mt-4 flex h-5 items-center justify-between gap-3 px-6 text-sm text-black/50">
        <p className="whitespace-nowrap">
          Showing {showingStart}–{showingEnd} of {totalChannels}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="muted"
            aria-label="Previous channel page"
            disabled={safePage === 0 || totalChannels === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="h-7 min-w-7 px-1.5 py-0"
          >
            <CaretLeft size={14} weight="bold" />
          </Button>
          <Button
            variant="muted"
            aria-label="Next channel page"
            disabled={safePage >= totalPages - 1 || totalChannels === 0}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="h-7 min-w-7 px-1.5 py-0"
          >
            <CaretRight size={14} weight="bold" />
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function parseChannelIds(raw: string | null): Set<number> {
  const out = new Set<number>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const n = Number(part);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

function sanitizeChannelIds(
  ids: Set<number>,
  channels: readonly IndexedChannel[] | null,
): Set<number> {
  if (!channels || ids.size === 0) return ids;
  const available = new Set(channels.map((channel) => channel.id));
  const next = new Set<number>();
  for (const id of ids) {
    if (available.has(id)) next.add(id);
  }
  return next;
}

function normalizeSelectedIds(
  ids: Set<number>,
  channels: readonly IndexedChannel[] | null,
): Set<number> {
  if (!channels || ids.size === 0) return ids;
  const selectableIds = channels
    .filter((channel) => channel.block_count > 0)
    .map((channel) => channel.id);
  if (
    selectableIds.length > 0 &&
    selectableIds.every((id) => ids.has(id))
  ) {
    return new Set();
  }
  return ids;
}

function setChannelParams(
  params: ReadonlyURLSearchParams,
  ids: Set<number>,
): string {
  const next = new URLSearchParams(params);
  next.delete("page");
  if (ids.size === 0) next.delete("channels");
  else next.set("channels", [...ids].sort((a, b) => a - b).join(","));
  removeEmptyParams(next);
  const qs = next.toString();
  return qs ? `?${qs}` : "?";
}

function removeEmptyParams(params: URLSearchParams) {
  for (const [key, value] of Array.from(params.entries())) {
    if (value === "") params.delete(key);
  }
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function ChannelRowPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="w-full rounded-base py-1 text-sm leading-5 opacity-0"
    >
      &nbsp;
    </div>
  );
}

function ChannelRow({
  label,
  count,
  selected,
  disabled = false,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group relative flex w-full items-center justify-between gap-3 rounded-base py-1 text-left text-sm leading-5 transition-colors",
        selected ? "text-white" : "text-neutral-800",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-2 -right-2 rounded-base"
          style={SELECTED_ROW_STYLE}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 -left-2 -right-2 rounded-base bg-black/5 opacity-0 transition-opacity group-hover:opacity-100",
            disabled && "group-hover:opacity-0",
          )}
        />
      )}
      <span className="relative z-10 min-w-0 max-w-[24ch] shrink overflow-hidden whitespace-nowrap">
        {truncateChannelLabel(label)}
      </span>
      <span className="relative z-10 shrink-0 tabular-nums">{count}</span>
    </button>
  );
}

function truncateChannelLabel(label: string): string {
  const chars = Array.from(label);
  if (chars.length <= 24) return label;
  return `${chars.slice(0, 21).join("")}...`;
}
