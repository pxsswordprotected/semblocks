"use client";

import { useCallback, useState } from "react";
import { BlocksTableCard } from "@/features/dashboard/blocks-table/BlocksTableCard";
import { BrandCard } from "@/features/dashboard/brand/BrandCard";
import { ChannelsCard } from "@/features/dashboard/channels/ChannelsCard";
import type { ChannelSummary } from "@/features/dashboard/channels/types";
import { DeveloperPanelCard } from "@/features/dashboard/developer-panel/DeveloperPanelCard";
import { SIDEBAR_W } from "@/features/dashboard/layout";
import { ProfileCard } from "@/features/dashboard/profile/ProfileCard";
import { RankingTableCard } from "@/features/dashboard/ranking-table/RankingTableCard";
import { RecQueryInputCard } from "@/features/dashboard/rec-query-input/RecQueryInputCard";
import type { RecommendationState } from "@/features/dashboard/recommendations/types";
import { SearchCard } from "@/features/dashboard/search/SearchCard";
import { SyncCard } from "@/features/dashboard/sync/SyncCard";

export function Dashboard({ ownerMode = false }: { ownerMode?: boolean }) {
  const [selectedChannels, setSelectedChannels] = useState<ChannelSummary[]>(
    [],
  );

  const [recommendation, setRecommendation] = useState<RecommendationState>({
    status: "idle",
  });
  const onChannelSelectionChange = useCallback((channels: ChannelSummary[]) => {
    setSelectedChannels(channels);
  }, []);

  return (
    <main className="flex h-screen min-h-0 flex-col gap-12 overflow-hidden p-page">
      {/* TOP BAR */}
      <div className="flex shrink-0 flex-row gap-12">
        <BrandCard className={`${SIDEBAR_W} min-h-[72px]`} />
        <div className="flex flex-1 flex-row gap-9">
          <ProfileCard className="min-h-[72px] flex-[1]" />
          <SyncCard className="min-h-[72px] flex-[1]" ownerMode={ownerMode} />
          <SearchCard className="min-h-[72px] flex-[2.3]" />
        </div>
      </div>

      {/* BODY — flex-1 so the bottom row reaches the 32px page margin. */}
      <div className="flex min-h-0 flex-1 flex-row gap-12">
        {/* LEFT SIDEBAR */}
        <div className={`flex min-h-0 flex-col gap-12 ${SIDEBAR_W}`}>
          <ChannelsCard
            className="h-[520px] shrink-0"
            onSelectionChange={onChannelSelectionChange}
          />
          <DeveloperPanelCard className="flex-1" ownerMode={ownerMode} />
        </div>

        {/* MAIN CONTENT */}
        <div className="flex min-h-0 flex-1 flex-col gap-12">
          <BlocksTableCard
            className="h-[520px] w-full shrink-0"
            selectedChannels={selectedChannels}
          />
          <div className="flex min-h-0 w-full flex-1 flex-row">
            <RecQueryInputCard
              className="h-full flex-[1] rounded-r-none border-r-0 shadow-[-1px_0_1px_rgb(0_0_0_/_0.05),-6px_0_14px_-6px_rgb(0_0_0_/_0.12),var(--shadow-inner-base)]"
              onStateChange={setRecommendation}
            />
            <RankingTableCard
              className="h-full flex-[2] rounded-l-none shadow-[1px_0_1px_rgb(0_0_0_/_0.05),6px_0_14px_-6px_rgb(0_0_0_/_0.12),var(--shadow-inner-base)]"
              recommendation={recommendation}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
