import { User } from "@phosphor-icons/react/dist/ssr";
import { Panel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";
import { PROFILE_URL, PROFILE_USERNAME } from "@/features/dashboard/profile/profile";


export function ProfileCard({ className }: { className?: string }) {
  return (
    <Panel
      className={cn(
        "flex flex-col justify-center items-center px-4 text-black/50",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[16px]">
        <User size={28} />
        <span select-none>
          Connected profile:{" "}
          <span className="text-neutral-800">{PROFILE_USERNAME}</span>
        </span>
      </div>
      <a
        href={PROFILE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 text-sm underline text-link-external"
      >
        {PROFILE_URL}
      </a>
    </Panel>
  );
}
