import { User } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";
import { PROFILE_URL, PROFILE_USERNAME } from "@/features/dashboard/profile/profile";


export function ProfileCard({ className }: { className?: string }) {
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
          Connected profile:{" "}
          <span className="text-neutral-800">{PROFILE_USERNAME}</span>
        </span>
      </div>
      <a
        href={PROFILE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block max-w-full truncate text-sm underline text-link-external"
      >
        {PROFILE_URL}
      </a>
    </Panel>
  );
}
