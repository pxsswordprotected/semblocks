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
import { useState } from "react";
import { Funnel } from "@phosphor-icons/react/dist/ssr";
import Button from "@/components/Button";
import { cn } from "@/lib/utils";

const FILTER_MENU_WIDTH = 200;
const FILTER_MENU_HEIGHT = 400;
const FILTER_MENU_SHADOW = "0 6px 18px rgba(0,0,0,0.08)";

export function FilterMenuButton() {
  const [open, setOpen] = useState(false);
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
              <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-3 text-sm text-black/50">
                200×400
              </div>
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
