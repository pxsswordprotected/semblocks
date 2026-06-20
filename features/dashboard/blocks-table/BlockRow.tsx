"use client";

import { safeExternalHref } from "@/lib/safe-url";
import type { Hit } from "@/lib/search-core";
import { BLOCK_GRID_CLASS, BLOCK_GRID_COLUMNS } from "./columns";
import {
  formatChannel,
  formatRank,
  formatType,
  truncateSnippet,
} from "./format";

type BlockRowProps = {
  hit: Hit;
  index: number; // 0-based offset within the visible page
  page: number;
  pageSize: number;
};

export function BlockRow({ hit, index, page, pageSize }: BlockRowProps) {
  const title = hit.title?.trim() || "(untitled)";
  const snippet = truncateSnippet(hit.snippet);

  return (
    <div
      className={`${BLOCK_GRID_CLASS} items-center text-base text-neutral-800`}
      style={{ gridTemplateColumns: BLOCK_GRID_COLUMNS }}
    >
      <div className="tabular-nums text-black/50">
        {formatRank(index, page, pageSize)}
      </div>
      <div
        className="min-w-0 overflow-hidden whitespace-nowrap text-ellipsis font-bold"
        title={title}
      >
        {title}
      </div>
      <div className="min-w-0 overflow-hidden whitespace-nowrap text-ellipsis">
        {formatType(hit.block_type)}
      </div>
      <div
        className="min-w-0 overflow-hidden whitespace-nowrap text-ellipsis"
        title={hit.channel_title ?? undefined}
      >
        {formatChannel(hit.channel_title)}
      </div>
      <div
        className="min-w-0 overflow-hidden whitespace-nowrap text-ellipsis text-black/70"
        title={hit.snippet ?? undefined}
      >
        {snippet}
      </div>
      <ActionsCell arenaUrl={hit.arena_url} sourceUrl={hit.source_url} />
    </div>
  );
}

// Actions cell: links are left-aligned with the Actions header. Both slots
// always render so the column reads uniformly down the table; a missing target
// renders as muted plain text rather than a link, and the divider stays so
// column rhythm is preserved.
function ActionsCell({
  arenaUrl,
  sourceUrl,
}: {
  arenaUrl: string | null;
  sourceUrl: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center justify-start gap-2 whitespace-nowrap">
      <LinkOrPlaceholder href={arenaUrl} label="Are.na" />
      <span className="text-black/20" aria-hidden="true">
        |
      </span>
      <LinkOrPlaceholder href={sourceUrl} label="Source" />
    </div>
  );
}

function LinkOrPlaceholder({
  href,
  label,
}: {
  href: string | null;
  label: string;
}) {
  const safeHref = safeExternalHref(href);
  if (!safeHref) {
    return <span className="text-black/30">{label}</span>;
  }
  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className="text-link-external hover:underline"
    >
      {label}
    </a>
  );
}
