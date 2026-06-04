import { Panel } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";

export function BrandCard({ className }: { className?: string }) {
  return (
    <Panel
      className={cn(
        "flex flex-col items-center justify-center select-none",
        className,
      )}
    >
      <p className="text-xl ">Semblocks v1.0</p>
      <a
        href="https://github.com/pxsswordprotected/semblocks"
        target="_blank"
        className="text-link-external underline text-sm"
      >
        Github
      </a>
    </Panel>
  );
}
