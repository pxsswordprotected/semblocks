"use client";

import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useTransitionStatus,
  type VirtualElement,
} from "@floating-ui/react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

type EvidenceBlock = {
  id: string | number;
  title?: string | null;
  href?: string | null;
};

type EvidenceBlocksHoverProps = {
  blocks: EvidenceBlock[];
  className?: string;
};

const POPUP_SHADOW = "0 6px 18px rgba(0,0,0,0.08)";


type ClientPoint = {
  x: number;
  y: number;
};

function makePointReference(point: ClientPoint): VirtualElement {
  return {
    getBoundingClientRect() {
      return {
        x: point.x,
        y: point.y,
        top: point.y,
        left: point.x,
        right: point.x,
        bottom: point.y,
        width: 0,
        height: 0,
      };
    },
  };
}
export function EvidenceBlocksHover({
  blocks,
  className,
}: EvidenceBlocksHoverProps) {
  const [open, setOpen] = useState(false);
  const openingPointRef = useRef<ClientPoint | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  function onOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
  }

  function captureOpeningPoint(event: PointerEvent<HTMLButtonElement>) {
    if (openingPointRef.current) return;

    const point = {
      x: event.clientX,
      y: event.clientY,
    };

    openingPointRef.current = point;
    refs.setPositionReference(makePointReference(point));
  }

  function captureReferencePoint() {
    if (openingPointRef.current) return;

    const reference = refs.domReference.current;
    if (!reference) return;

    const rect = reference.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };

    openingPointRef.current = point;
    refs.setPositionReference(makePointReference(point));
  }


  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement: "top-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(12), flip(), shift({ padding: 8 })],
    strategy: "fixed",
  });

  const hover = useHover(context, {
    delay: { open: 0, close: 0 },
    handleClose: safePolygon({ buffer: 4 }),
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context, { escapeKey: true });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);

  const { isMounted, status } = useTransitionStatus(context, {
    duration: { open: 0, close: 150 },
  });



  useEffect(() => {
    if (isMounted || open) return;

    openingPointRef.current = null;
  }, [isMounted, open]);

  const count = blocks.length;
  const blockNoun = count === 1 ? "block" : "blocks";

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={cn(
          "text-base text-black/50 underline-offset-2 hover:underline",
          "focus:outline-none focus:ring-2 focus:ring-black/20",
          className,
        )}
        aria-label={`${count} evidence ${blockNoun}`}
        {...getReferenceProps({
          onFocus: captureReferencePoint,
          onPointerEnter: captureOpeningPoint,
        })}
      >
        {count} {blockNoun}
      </button>

      {isMounted ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div
              ref={(node) => {
                panelRef.current = node;
              }}
              data-status={status}
              className={cn(
                "flex max-h-[400px] w-[200px] flex-col overflow-hidden rounded-[1px] border border-black/10",
                "bg-dashboard bg-[image:var(--gradient-panel)] font-sans text-black",
                "transition-opacity duration-0 ease-[var(--ease-out-quad)]",
                "will-change-[opacity]",
                "data-[status=close]:opacity-0 data-[status=close]:duration-150",
                "motion-reduce:transition-none",
              )}
              style={{ boxShadow: POPUP_SHADOW }}
            >
              <div className="shrink-0 border-b border-black/10 px-3 py-2 font-[Arial] text-[16px] font-bold text-neutral-800">
                Evidence blocks
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <ul className="flex flex-col gap-3 px-3 py-3">
                {blocks.map((block) => {
                  const href = block.href ?? `https://www.are.na/block/${block.id}`;
                  const title = block.title?.trim() || `Block ${block.id}`;

                  return (
                    <li key={block.id}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        title={title}
                        className="block overflow-hidden text-base text-ellipsis whitespace-nowrap text-link-external hover:underline"
                      >
                        {title}
                      </a>
                    </li>
                  );
                })}
                </ul>
              </div>
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
