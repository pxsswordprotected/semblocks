"use client";

import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  useTransitionStatus,
} from "@floating-ui/react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Funnel } from "@phosphor-icons/react/dist/ssr";
import Button from "@/components/Button";
import { cn } from "@/lib/utils";
import { BLOCK_TYPE_FILTERS } from "@/lib/search-filters";
import type { BlockTypeFilter } from "@/lib/search-filters";
import {
  parseSearchFilters,
  searchFiltersEqual,
  serializeSearchFilters,
  toggleBlockTypeFilter,
} from "./searchFilters";

const FILTER_MENU_WIDTH = 200;
const FILTER_MENU_HEIGHT = 400;
const FILTER_MENU_SHADOW = "0 6px 18px rgba(0,0,0,0.08)";

const SELECTED_FILTER_ROW_STYLE = {
  backgroundColor: "#141414",
  boxShadow: [
    "0 1px 1.7px rgb(0 0 0 / 0.19)",
    "inset 0 0 0 1px rgb(0 0 0 / 0.10)",
    "inset -1px -1px 3.6px rgb(245 245 245 / 0.82)",
    "inset 0 0 7.6px rgb(255 255 255 / 0.40)",
  ].join(", "),
} satisfies CSSProperties;

type FilterMenuButtonProps = {
  ownerMode?: boolean;
};

export function FilterMenuButton({ ownerMode = false }: FilterMenuButtonProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const committedFilters = useMemo(() => parseSearchFilters(params), [params]);
  const [draftFilters, setDraftFilters] = useState(committedFilters);
  const applyDisabled = searchFiltersEqual(draftFilters, committedFilters);

  useEffect(() => {
    if (open) setDraftFilters(committedFilters);
  }, [committedFilters, open]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-end",
    whileElementsMounted: autoUpdate,
    middleware: [offset(12), flip(), shift({ padding: 8 })],
    strategy: "fixed",
  });
  const click = useClick(context);
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: true });
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);
  const { isMounted, status } = useTransitionStatus(context, {
    duration: { open: 0, close: 150 },
  });

  function toggleType(blockType: BlockTypeFilter) {
    setDraftFilters((current) => toggleBlockTypeFilter(current, blockType));
  }

  function applyFilters() {
    if (applyDisabled) return;
    const nextParams = serializeSearchFilters(
      new URLSearchParams(params.toString()),
      draftFilters,
    );
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `?${nextQuery}` : "?", { scroll: false });
    setOpen(false);
  }

  return (
    <>
      <Button
        ref={refs.setReference}
        type="button"
        aria-label="Filter blocks"
        aria-expanded={open}
        className="absolute top-1/2 right-6 flex h-9 w-9 -translate-y-1/2 items-center justify-center px-0 py-0"
        {...getReferenceProps()}
      >
        <Funnel size={22} weight="bold" />
      </Button>

      {isMounted ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div
              data-status={status}
              className={cn(
                "flex flex-col overflow-hidden rounded-[1px] border border-black/10",
                "bg-dashboard bg-[image:var(--gradient-panel)] font-sans text-black",
                "transition-opacity duration-0 ease-[var(--ease-out-quad)]",
                "will-change-[opacity]",
                "data-[status=close]:opacity-0 data-[status=close]:duration-150",
                "motion-reduce:transition-none",
              )}
              style={{
                width: FILTER_MENU_WIDTH,
                height: FILTER_MENU_HEIGHT,
                boxShadow: FILTER_MENU_SHADOW,
              }}
            >
              <div className="shrink-0 border-b border-black/10 px-3 py-2 font-[Arial] text-[16px] font-bold text-neutral-800">
                Filters
              </div>
              {ownerMode ? (
                <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
                  <div className="font-[Arial] text-base leading-5 text-neutral-800">
                    Block types
                  </div>
                  <div className="mt-3 flex flex-col gap-1">
                    {BLOCK_TYPE_FILTERS.map((blockType) => (
                      <BlockTypeFilterOption
                        key={blockType}
                        label={blockType}
                        selected={draftFilters.blockTypes.includes(blockType)}
                        onClick={() => toggleType(blockType)}
                      />
                    ))}
                  </div>
                  <div className="mt-4 h-px w-full shrink-0 bg-stroke" />
                  <Button
                    type="button"
                    disabled={applyDisabled}
                    className="mt-4 h-9 w-full"
                    onClick={applyFilters}
                  >
                    Apply filters
                  </Button>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-3 text-center font-[Arial] text-base leading-5 text-black/50">
                  You must be in dev mode to use filters.
                </div>
              )}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

function BlockTypeFilterOption({
  label,
  selected,
  onClick,
}: {
  label: BlockTypeFilter;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center rounded-base py-1 text-left text-sm leading-5 transition-colors",
        selected ? "text-white" : "text-neutral-800",
      )}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-y-0.5 -left-2 -right-2 rounded-base"
          style={SELECTED_FILTER_ROW_STYLE}
        />
      ) : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-y-0.5 -left-2 -right-2 rounded-base bg-black/5 opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      <span className="relative z-10 min-w-0 truncate">{label}</span>
    </button>
  );
}
