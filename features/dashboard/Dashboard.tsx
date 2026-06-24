"use client";

import { useCallback, useEffect, useState } from "react";
import { BlocksTableCard } from "@/features/dashboard/blocks-table/BlocksTableCard";
import { BrandCard } from "@/features/dashboard/brand/BrandCard";
import { ChannelsCard } from "@/features/dashboard/channels/ChannelsCard";
import type { ChannelSummary } from "@/features/dashboard/channels/types";
import { DeveloperPanelCard } from "@/features/dashboard/developer-panel/DeveloperPanelCard";
import {
  DASHBOARD_GAP,
  DASHBOARD_PRIMARY_PANEL_H,
  DASHBOARD_TOP_CARD_GAP,
  DASHBOARD_TOP_H,
  SIDEBAR_W,
} from "@/features/dashboard/layout";
import { ProfileCard } from "@/features/dashboard/profile/ProfileCard";
import { RankingTableCard } from "@/features/dashboard/ranking-table/RankingTableCard";
import { RecQueryInputCard } from "@/features/dashboard/rec-query-input/RecQueryInputCard";
import type { RecommendationState } from "@/features/dashboard/recommendations/types";
import { SearchCard } from "@/features/dashboard/search/SearchCard";
import { SyncCard } from "@/features/dashboard/sync/SyncCard";
import type { DashboardProfileConfig } from "@/lib/profile-config";

export function Dashboard({ ownerMode = false }: { ownerMode?: boolean }) {
  const [selectedChannels, setSelectedChannels] = useState<ChannelSummary[]>(
    [],
  );
  const [profileConfig, setProfileConfig] =
    useState<DashboardProfileConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile");
        const body = (await res.json()) as DashboardProfileConfig | { error: string };
        if (!cancelled && res.ok && !("error" in body)) {
          setProfileConfig(body);
        }
      } catch {
        if (!cancelled) setProfileConfig(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);


  const [recommendation, setRecommendation] = useState<RecommendationState>({
    status: "idle",
  });
  const onChannelSelectionChange = useCallback((channels: ChannelSummary[]) => {
    setSelectedChannels(channels);
  }, []);

  return (
    <main
      className={`flex h-screen min-h-0 flex-col overflow-hidden px-[44px] py-[clamp(1rem,2vw,2rem)] ${DASHBOARD_GAP}`}
    >
      {/* TOP BAR */}
      <div className={`flex shrink-0 flex-row ${DASHBOARD_GAP}`}>
        <BrandCard className={`${SIDEBAR_W} ${DASHBOARD_TOP_H} shrink-0`} />
        <div className={`flex min-w-0 flex-1 flex-row ${DASHBOARD_TOP_CARD_GAP}`}>
          <ProfileCard
            className={`${DASHBOARD_TOP_H} min-w-0 flex-[1]`}
            profileConfig={profileConfig}
          />
          <SyncCard
            className={`${DASHBOARD_TOP_H} min-w-0 flex-[1]`}
            ownerMode={ownerMode}
            profileConfig={profileConfig}
          />
          <SearchCard className={`${DASHBOARD_TOP_H} min-w-0 flex-[2.3]`} ownerMode={ownerMode} />
        </div>
      </div>

      {/* BODY — flex-1 so the bottom row reaches the 32px page margin. */}
      <div className={`flex min-h-0 flex-1 flex-row ${DASHBOARD_GAP}`}>
        {/* LEFT SIDEBAR */}
        <div className={`flex min-h-0 flex-col ${DASHBOARD_GAP} ${SIDEBAR_W}`}>
          <ChannelsCard
            className={`${DASHBOARD_PRIMARY_PANEL_H} shrink-0`}
            onSelectionChange={onChannelSelectionChange}
          />
          <DeveloperPanelCard
            className="min-h-0 flex-1"
            ownerMode={ownerMode}
            selectedChannels={selectedChannels}
          />
        </div>

        {/* MAIN CONTENT */}
        <div className={`flex min-w-0 min-h-0 flex-1 flex-col ${DASHBOARD_GAP}`}>
          <BlocksTableCard
            className={`${DASHBOARD_PRIMARY_PANEL_H} min-w-0 w-full shrink-0`}
            selectedChannels={selectedChannels}
            ownerMode={ownerMode}
          />
          <div className="flex min-h-0 min-w-0 w-full flex-1 flex-row">
            <RecQueryInputCard
              className="h-full min-w-0 flex-[1] rounded-r-none border-r-0 shadow-[-1px_0_1px_rgb(0_0_0_/_0.05),-6px_0_14px_-6px_rgb(0_0_0_/_0.12),var(--shadow-inner-base)]"
              ownerMode={ownerMode}
              onStateChange={setRecommendation}
            />
            <RankingTableCard
              className="h-full min-w-0 flex-[2] rounded-l-none shadow-[1px_0_1px_rgb(0_0_0_/_0.05),6px_0_14px_-6px_rgb(0_0_0_/_0.12),var(--shadow-inner-base)]"
              recommendation={recommendation}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
