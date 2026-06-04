"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import Button from "@/components/Button";
import { cn } from "@/lib/utils";
import { getPageItems } from "./pagination";
import type { SearchHitsState } from "./useSearchHits";

type FooterProps = {
  status: SearchHitsState["status"];
  page: number;
  pageSize: number;
  totalCount: number;
};

// Reserved-height row; mirrors the header (`h-5 px-6`) so the footer
// always occupies the same slot whether or not it has content.
const FOOTER_SHELL = "mt-4 flex h-5 items-center justify-between gap-3 px-6";

export function BlocksTableFooter({
  status,
  page,
  pageSize,
  totalCount,
}: FooterProps) {
  // Footer renders content only when there's something to say. Idle /
  // loading / error keep the slot reserved (stable card height) but
  // empty — avoids "Showing 1-8 of …" flicker between fetches.
  if (status !== "ready" || totalCount === 0) {
    return (
      <div className={FOOTER_SHELL}>
        {status === "ready" && totalCount === 0 ? (
          <span className="text-sm text-black/50">No matches.</span>
        ) : null}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalCount);

  return (
    <div className={FOOTER_SHELL}>
      <span className="text-sm whitespace-nowrap text-black/50">
        Showing {start}–{end} of {totalCount}
      </span>
      <Pagination current={safePage} total={totalPages} />
    </div>
  );
}

function Pagination({ current, total }: { current: number; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  if (total <= 1) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="primary"
          aria-label="Page 1"
          aria-current="page"
          disabled
          className="h-7 min-w-7 px-1.5 py-0 text-sm tabular-nums disabled:opacity-100"
        >
          1
        </Button>
      </div>
    );
  }

  function gotoPage(n: number) {
    const next = new URLSearchParams(params);
    // Page 1 is the implicit default; keep the URL clean by omitting it.
    if (n === 1) next.delete("page");
    else next.set("page", String(n));
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  }

  const items = getPageItems(current, total);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="muted"
        aria-label="Previous page"
        disabled={current <= 1}
        onClick={() => gotoPage(current - 1)}
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
            aria-label={`Page ${item.n}`}
            aria-current={item.n === current ? "page" : undefined}
            onClick={() => gotoPage(item.n)}
            className={cn(
              "h-7 min-w-7 px-1.5 py-0 text-sm tabular-nums",
            )}
          >
            {item.n}
          </Button>
        ),
      )}

      <Button
        variant="muted"
        aria-label="Next page"
        disabled={current >= total}
        onClick={() => gotoPage(current + 1)}
        className="h-7 min-w-7 px-1.5 py-0"
      >
        <CaretRight size={14} weight="bold" />
      </Button>
    </div>
  );
}
