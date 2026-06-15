"use client";

import { Suspense, useEffect, useState } from "react";
import { Panel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";
import { BlocksTableContent } from "./BlocksTableContent";
import { BlocksTableContentSkeleton } from "./BlocksTableContentSkeleton";
import { BLOCK_GRID_CLASS, BLOCK_GRID_COLUMNS } from "./columns";
import { FilterMenuButton } from "./FilterMenuButton";
import type { ChannelSummary } from "../channels/types";


type BlocksTableCardProps = {
  className?: string;
  selectedChannels?: ChannelSummary[];
  ownerMode?: boolean;
};

export function BlocksTableCard({
  className,
  selectedChannels = [],
  ownerMode = false,
}: BlocksTableCardProps) {
  const [totalBlocks, setTotalBlocks] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadBlockSummary() {
      try {
        const res = await fetch("/api/blocks/summary");
        const body = (await res.json()) as
          | { block_count: number }
          | { error: string };
        if (!res.ok || "error" in body) return;
        if (!cancelled) setTotalBlocks(body.block_count);
      } catch (err) {
        console.error("[BlocksTableCard]", err);
      }
    }

    void loadBlockSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  const heading = formatBlocksFor(selectedChannels, totalBlocks);

  return (
    <Panel className={cn("flex min-w-0 flex-col overflow-hidden py-4", className)}>
      <header className="relative h-5 px-6">
        <h2 className="min-w-0 truncate text-base leading-5 font-bold text-neutral-800">
          <span className="text-black/50">Blocks for: </span>
          {heading}
        </h2>
        <FilterMenuButton />
      </header>

      <div className="mt-4 h-px shrink-0 bg-stroke" />

      <div
        className={`${BLOCK_GRID_CLASS} mt-4 text-base leading-5 font-bold text-neutral-800`}
        style={{ gridTemplateColumns: BLOCK_GRID_COLUMNS }}
      >
        <div>Rank</div>
        <div>Title</div>
        <div>Type</div>
        <div>Channel</div>
        <div>Snippet</div>
        <div>View</div>
      </div>

      <div className="mt-4 h-px shrink-0 bg-stroke" />

      <Suspense fallback={<BlocksTableContentSkeleton />}>
        <BlocksTableContent ownerMode={ownerMode} />
      </Suspense>
    </Panel>
  );
}


function formatBlocksFor(
  channels: ChannelSummary[],
  totalBlocks: number,
): string {
  if (channels.length === 0) {
    return `All channels (${totalBlocks} blocks)`;
  }

  const names = channels
    .slice(0, 2)
    .map((channel) => channel.title?.trim() || "(untitled)");
  const remaining = channels.length - names.length;
  const selectedBlocks = channels.reduce(
    (sum, channel) => sum + channel.block_count,
    0,
  );

  return `${names.join(", ")}${remaining > 0 ? `, +${remaining} more` : ""} (${selectedBlocks} blocks)`;
}
