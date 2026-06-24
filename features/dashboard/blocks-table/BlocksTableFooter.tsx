"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import Button from "@/components/Button";
import type { SearchHitsState } from "./useSearchHits";
import { clampResultLimit, DEFAULT_RESULT_LIMIT } from "./resultLimit";

type FooterProps = {
  status: SearchHitsState["status"];
  page: number;
  pageSize: number;
  totalCount: number;
  resultLimit: number;
  ownerMode: boolean;
};

// Reserved-height row; mirrors the header (`h-5 px-6`) so the footer
// always occupies the same slot whether or not it has content.
const FOOTER_SHELL = "mt-4 flex h-5 items-center justify-between gap-3 px-6";

export function BlocksTableFooter({
  status,
  page,
  pageSize,
  totalCount,
  resultLimit,
  ownerMode,
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
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalCount);

  return (
    <div className={FOOTER_SHELL}>
      <span className="text-sm whitespace-nowrap text-black/50">
        Showing {start}–{end} of{" "}
        <EditableResultLimit value={resultLimit} ownerMode={ownerMode} />
      </span>
      <Pagination current={safePage} total={totalPages} />
    </div>
  );
}

function EditableResultLimit({
  value,
  ownerMode,
}: {
  value: number;
  ownerMode: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState(String(value));
  const [showDevModeTip, setShowDevModeTip] = useState(false);
  const skipNextBlurCommit = useRef(false);
  const devModeTipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  useEffect(() => {
    return () => {
      if (devModeTipTimer.current) clearTimeout(devModeTipTimer.current);
    };
  }, []);

  function showBlockedEditTip() {
    if (devModeTipTimer.current) clearTimeout(devModeTipTimer.current);
    setShowDevModeTip(true);
    devModeTipTimer.current = setTimeout(() => {
      setShowDevModeTip(false);
      devModeTipTimer.current = null;
    }, 3000);
  }

  function commit() {
    if (!ownerMode) {
      const attemptedChange = draft.trim() !== String(value);
      const next = new URLSearchParams(params);
      const hadBlockedParams = next.has("k") || next.has("page");

      setDraft(String(value));
      if (hadBlockedParams) {
        next.delete("k");
        next.delete("page");
        const qs = next.toString();
        startTransition(() => {
          router.replace(qs ? `?${qs}` : "?", { scroll: false });
        });
      }
      if (attemptedChange || hadBlockedParams) showBlockedEditTip();
      return;
    }

    const nextValue = clampResultLimit(Number(draft));
    if (nextValue === value) {
      setDraft(String(value));
      return;
    }

    setDraft(String(nextValue));
    const next = new URLSearchParams(params);
    if (nextValue === DEFAULT_RESULT_LIMIT) {
      next.delete("k");
    } else {
      next.set("k", String(nextValue));
    }
    next.delete("page");

    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  }

  function handleBlur() {
    if (skipNextBlurCommit.current) {
      skipNextBlurCommit.current = false;
      return;
    }
    commit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      skipNextBlurCommit.current = true;
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skipNextBlurCommit.current = true;
      setDraft(String(value));
      event.currentTarget.blur();
    }
  }

  return (
    <span className="relative inline-flex items-center">
      <input
        aria-label="Search result count"
        className="inline-block w-[3ch] border-b border-black/40 bg-transparent text-center tabular-nums text-black/70 outline-none focus:border-black"
        inputMode="numeric"
        value={draft}
        onBlur={handleBlur}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {showDevModeTip ? (
        <span
          role="status"
          className="absolute top-1/2 left-full z-10 ml-2 w-64 -translate-y-1/2 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs whitespace-normal text-red-700 shadow-sm"
        >
          Changing the number of displayed blocks is only available in dev mode.
        </span>
      ) : null}
    </span>
  );
}

function Pagination({ current, total }: { current: number; total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

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

      <span className="min-w-12 px-1 text-center text-sm font-normal tabular-nums text-neutral-800">
        {current}/{total}
      </span>
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
