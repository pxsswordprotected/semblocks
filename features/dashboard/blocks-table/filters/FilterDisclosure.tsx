"use client";

import { useState, type ReactNode } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react/dist/ssr";

type FilterDisclosureProps = {
  title: string;
  controlsId: string;
  children: ReactNode;
};

export function FilterDisclosure({
  title,
  controlsId,
  children,
}: FilterDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? CaretDown : CaretUp;

  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={controlsId}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-2 font-[Arial] text-base leading-5 text-neutral-800"
      >
        <span>{title}</span>
        <Chevron size={16} weight="bold" aria-hidden="true" />
      </button>
      {expanded ? (
        <div id={controlsId} className="flex flex-col gap-1">
          {children}
        </div>
      ) : null}
    </>
  );
}
