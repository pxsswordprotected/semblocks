"use client";

import { useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import Button from "@/components/Button";
import { Panel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";
import { getPageItems } from "../blocks-table/pagination";
import type { RecommendationState, RecChannel } from "../recommendations/types";
import { RECOMMENDATION_GRID_COLUMNS } from "./columns";
import { formatChannelTitle, formatEvidence } from "./format";

type RankingTableCardProps = {
  className?: string;
  recommendation: RecommendationState;
};

const RECOMMENDATIONS_PER_PAGE = 4;

type ConfidenceLevel = "High" | "Medium" | "Low";

const CONFIDENCE_PILL_SHADOW = [
  "0 1px 1px rgb(0 0 0 / 0.10)",
  "inset 1px 1px 2.8px rgb(245 245 245 / 0.80)",
  "inset 0 0 0 1px rgb(0 0 0 / 0.10)",
].join(", ");

function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.75) return "High";
  if (score >= 0.45) return "Medium";
  return "Low";
}

export function RankingTableCard({
  className,
  recommendation,
}: RankingTableCardProps) {
  return (
    <Panel className={cn("flex flex-col py-4", className)}>

      <div
        className="grid gap-4 px-6 text-base leading-5 font-bold text-neutral-800"
        style={{ gridTemplateColumns: RECOMMENDATION_GRID_COLUMNS }}
      >
        <div>Rank</div>
        <div>Channel</div>
        <div>Confidence</div>
        <div>Evidence</div>
      </div>

      <div className="mt-4 h-px shrink-0 bg-stroke" />

      <RecommendationBody recommendation={recommendation} />
    </Panel>
  );
}

function RecommendationBody({
  recommendation,
}: {
  recommendation: RecommendationState;
}) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [recommendation]);

  if (recommendation.status === "idle") {
    return (
      <p className="flex-1 px-6 pt-4 text-sm leading-5 text-black/50">
        Enter text or choose an image to see channel recommendations.
      </p>
    );
  }

  if (recommendation.status === "loading") {
    return (
      <p className="flex-1 px-6 pt-4 text-sm leading-5 text-black/50">
        Finding recommended channels…
      </p>
    );
  }

  if (recommendation.status === "error") {
    return (
      <p className="flex-1 px-6 pt-4 text-sm leading-5 text-error">
        Recommendation failed: {recommendation.error}
      </p>
    );
  }

  const { result } = recommendation;
  if (result.channels.length === 0) {
    return (
      <div className="flex-1 space-y-2 px-6 pt-4 text-sm leading-5 text-black/50">
        <p>No channels above threshold.</p>
        <p>{result.input_chars} chars analyzed</p>
      </div>
    );
  }

  const totalCount = result.channels.length;
  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / RECOMMENDATIONS_PER_PAGE),
  );
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * RECOMMENDATIONS_PER_PAGE;
  const visibleChannels = result.channels.slice(
    start,
    start + RECOMMENDATIONS_PER_PAGE,
  );
  const slotCount = Math.max(
    visibleChannels.length,
    RECOMMENDATIONS_PER_PAGE,
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col justify-evenly">
        {Array.from({ length: slotCount }, (_, i) => {
          const channel = visibleChannels[i];
          if (channel) {
            return (
              <RecommendationRow
                key={channel.channel_id}
                channel={channel}
                rank={start + i + 1}
              />
            );
          }
          return (
            <div
              key={`recommendation-spacer-${i}`}
              aria-hidden="true"
              className="invisible h-6"
            />
          );
        })}
      </div>
      <div className="h-px shrink-0 bg-stroke" />
      <RecommendationFooter
        page={safePage}
        pageSize={RECOMMENDATIONS_PER_PAGE}
        totalCount={totalCount}
        inputChars={result.input_chars}
        onPageChange={setPage}
      />
    </>
  );
}

function RecommendationRow({
  channel,
  rank,
}: {
  channel: RecChannel;
  rank: number;
}) {
  const title = formatChannelTitle(channel.channel_title);
  const evidence = formatEvidence(channel);

  return (
    <div
      className="grid items-center gap-4 px-6 text-base text-neutral-800"
      style={{ gridTemplateColumns: RECOMMENDATION_GRID_COLUMNS }}
    >
      <div className="tabular-nums text-black/50">{rank}</div>
      <div className="min-w-0 overflow-hidden whitespace-nowrap text-ellipsis font-bold">
        {channel.channel_url ? (
          <a
            href={channel.channel_url}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            className="text-link-external underline hover:opacity-80"
          >
            {title}
          </a>
        ) : (
          <span title={title}>{title}</span>
        )}
      </div>
      <div>
        <ConfidencePill score={channel.score} />
      </div>
      <div
        className="min-w-0 overflow-hidden whitespace-nowrap text-ellipsis text-black/70"
        title={evidence}
      >
        {evidence}
      </div>
    </div>
  );
}

function ConfidencePill({ score }: { score: number }) {
  const level = getConfidenceLevel(score);

  return (
    <span
      title={score.toFixed(3)}
      className={cn(
        "inline-flex h-6 min-w-16 items-center justify-center rounded-pill px-3",
        "text-xs leading-none font-bold text-white select-none",
        level === "High" && "bg-neutral-800",
        level === "Medium" && "bg-neutral-600",
        level === "Low" && "bg-neutral-400",
      )}
      style={{ boxShadow: CONFIDENCE_PILL_SHADOW }}
    >
      {level}
    </span>
  );
}


function RecommendationFooter({
  page,
  pageSize,
  totalCount,
  inputChars,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  inputChars: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="mt-4 flex h-5 items-center justify-between gap-3 px-6">
      <span className="text-sm whitespace-nowrap text-black/50">
        Showing {start}–{end} of {totalCount}
        <span className="hidden lg:inline"> · {inputChars} chars analyzed</span>
      </span>
      <RecommendationPagination
        current={page}
        total={totalPages}
        onPageChange={onPageChange}
      />
    </div>
  );
}

function RecommendationPagination({
  current,
  total,
  onPageChange,
}: {
  current: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const items = useMemo(() => getPageItems(current, total), [current, total]);

  if (total <= 1) return null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="muted"
        aria-label="Previous recommendation page"
        disabled={current <= 1}
        onClick={() => onPageChange(current - 1)}
        className="h-7 min-w-7 px-1.5 py-0"
      >
        <CaretLeft size={14} weight="bold" />
      </Button>

      {items.map((item) =>
        item.kind === "ellipsis" ? (
          <span
            key={`ellipsis-${item.key}`}
            aria-hidden="true"
            className="px-1 text-sm text-black/30 select-none"
          >
            …
          </span>
        ) : (
          <Button
            key={item.n}
            variant={item.n === current ? "primary" : "muted"}
            aria-label={`Recommendation page ${item.n}`}
            aria-current={item.n === current ? "page" : undefined}
            onClick={() => onPageChange(item.n)}
            className="h-7 min-w-7 px-1.5 py-0 text-sm tabular-nums"
          >
            {item.n}
          </Button>
        ),
      )}

      <Button
        variant="muted"
        aria-label="Next recommendation page"
        disabled={current >= total}
        onClick={() => onPageChange(current + 1)}
        className="h-7 min-w-7 px-1.5 py-0"
      >
        <CaretRight size={14} weight="bold" />
      </Button>
    </div>
  );
}
