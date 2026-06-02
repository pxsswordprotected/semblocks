import { Panel } from "@/components/dashboard/panel";
import { BrandCard } from "@/features/dashboard/brand/BrandCard";

export function DashboardViewportGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="dashboard-viewport-content">{children}</div>
      <ViewportFallback />
    </>
  );
}

function ViewportFallback() {
  return (
    <main className="dashboard-viewport-fallback min-h-screen flex-col bg-page-bg p-[clamp(1rem,4vw,2rem)]">
      <BrandCard className="h-[72px] w-full shrink-0" />
      <Panel className="mt-[clamp(1rem,4vw,3rem)] flex flex-1 flex-col justify-center px-[clamp(1.5rem,6vw,3rem)] py-[clamp(2rem,8vh,4rem)]">
        <div className="mx-auto max-w-[52ch] text-center">
          <h1 className="text-xl leading-6 font-bold text-neutral-800">
            AResearch needs a larger desktop viewport.
          </h1>
          <p className="mt-3 text-sm leading-5 text-black/50">
            This dashboard is designed for a wide-screen layout with multiple
            panels for search, sync status, channels, and recommendations.
          </p>
          <p className="mt-3 rounded-base border border-stroke bg-white/30 px-3 py-2 text-sm leading-5 text-neutral-800">
            Please use a desktop or laptop window at least 1200 × 760.
          </p>
        </div>
      </Panel>
    </main>
  );
}
