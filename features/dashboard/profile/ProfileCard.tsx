import { User } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";
import type { DashboardProfileConfig } from "@/lib/profile-config";

export function ProfileCard({
  className,
  profileConfig,
}: {
  className?: string;
  profileConfig: DashboardProfileConfig | null;
}) {
  const profile = profileConfig?.display_profile ?? null;
  return (
    <Panel
      className={cn(
        "flex min-w-0 flex-col justify-center items-center overflow-hidden px-4 text-black/50",
        className,
      )}
    >
      <div className="flex min-w-0 max-w-full items-center gap-1.5 text-[16px]">
        <User size={28} className="shrink-0" />
        <span className="min-w-0 truncate select-none">
          {profile ? (
            <>
              Connected profile:{" "}
              <span className="text-neutral-800">{profile.username}</span>
            </>
          ) : profileConfig === null ? (
            "Loading profile…"
          ) : (
            <span className="text-neutral-800">No profile configured</span>
          )}
        </span>
      </div>
      {profile ? (
        <a
          href={profile.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block max-w-full truncate text-sm underline text-link-external"
        >
          {profile.url}
        </a>
      ) : (
        <span className="mt-1 block max-w-full truncate text-sm text-black/50">
          Set ARENA_PROFILE_SLUG
        </span>
      )}
    </Panel>
  );
}
