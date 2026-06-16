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
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Funnel } from "@phosphor-icons/react/dist/ssr";
import Button from "@/components/Button";
import { cn } from "@/lib/utils";
import {
  parseSearchFilters,
  searchFiltersEqual,
  serializeSearchFilters,
} from "./searchFilters";
import { BlockTypeFilter } from "./filters/BlockTypeFilter";
import { DateAddedFilter } from "./filters/DateAddedFilter";

const FILTER_MENU_WIDTH = 300;
const FILTER_MENU_HEIGHT = 400;
const FILTER_MENU_SHADOW = "0 6px 18px rgba(0,0,0,0.08)";

type FilterMenuButtonProps = {
  ownerMode?: boolean;
};

export function FilterMenuButton(props: FilterMenuButtonProps) {
  return (
    <Suspense fallback={<FilterMenuButtonFallback />}>
      <FilterMenuButtonInner {...props} />
    </Suspense>
  );
}

function FilterMenuButtonFallback() {
  return (
    <Button
      type="button"
      aria-label="Filter blocks"
      aria-expanded={false}
      disabled
      className="absolute top-1/2 right-6 flex h-9 w-9 -translate-y-1/2 items-center justify-center px-0 py-0"
    >
      <Funnel size={22} weight="bold" />
    </Button>
  );
}

function FilterMenuButtonInner({ ownerMode = false }: FilterMenuButtonProps) {
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
  const dismiss = useDismiss(context, {
    escapeKey: true,
    outsidePress: (event) =>
      !(
        event.target instanceof Element &&
        event.target.closest("[data-filter-popover]")
      ),
  });
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);
  const { isMounted, status } = useTransitionStatus(context, {
    duration: { open: 0, close: 150 },
  });

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
                "flex select-none flex-col overflow-hidden rounded-[1px] border border-black/10",
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
                <div className="relative flex min-h-0 flex-1 flex-col px-3 py-3 pb-16">
                  <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <BlockTypeFilter
                      value={draftFilters.blockTypes}
                      onChange={(blockTypes) =>
                        setDraftFilters((current) => ({
                          ...current,
                          blockTypes,
                        }))
                      }
                    />
                    <DateAddedFilter
                      value={draftFilters.dateAdded}
                      onChange={(dateAdded) =>
                        setDraftFilters((current) => ({
                          ...current,
                          dateAdded,
                        }))
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={applyDisabled}
                    className="absolute right-3 bottom-3 left-3 h-9"
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
