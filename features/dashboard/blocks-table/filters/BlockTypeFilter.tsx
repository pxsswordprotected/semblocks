"use client";

import { useState, type CSSProperties } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react/dist/ssr";
import {
  BLOCK_TYPE_FILTERS,
  type BlockTypeFilter as BlockTypeFilterValue,
} from "@/lib/search-filters";
import { cn } from "@/lib/utils";
import { toggleBlockTypeFilter } from "../searchFilters";

const SELECTED_FILTER_ROW_STYLE = {
  backgroundColor: "#141414",
  boxShadow: [
    "0 1px 1.7px rgb(0 0 0 / 0.19)",
    "inset 0 0 0 1px rgb(0 0 0 / 0.10)",
    "inset -1px -1px 3.6px rgb(245 245 245 / 0.82)",
    "inset 0 0 7.6px rgb(255 255 255 / 0.40)",
  ].join(", "),
} satisfies CSSProperties;

type BlockTypeFilterProps = {
  value: readonly BlockTypeFilterValue[];
  onChange: (next: readonly BlockTypeFilterValue[]) => void;
};

export function BlockTypeFilter({ value, onChange }: BlockTypeFilterProps) {
  const [expanded, setExpanded] = useState(true);

  function toggleType(blockType: BlockTypeFilterValue) {
    const next = toggleBlockTypeFilter({ blockTypes: value }, blockType);
    onChange(next.blockTypes);
  }
  const Chevron = expanded ? CaretDown : CaretUp;

  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="block-type-filter-options"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-2 font-[Arial] text-base leading-5 text-neutral-800"
      >
        <span>Block types</span>
        <Chevron size={16} weight="bold" aria-hidden="true" />
      </button>
      {expanded ? (
        <div
          id="block-type-filter-options"
          className="mt-3 flex flex-col gap-1"
        >
          {BLOCK_TYPE_FILTERS.map((blockType) => (
            <BlockTypeFilterOption
              key={blockType}
              label={blockType}
              selected={value.includes(blockType)}
              onClick={() => toggleType(blockType)}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function BlockTypeFilterOption({
  label,
  selected,
  onClick,
}: {
  label: BlockTypeFilterValue;
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
          className="pointer-events-none absolute inset-y-0 -left-2 -right-2 rounded-base"
          style={SELECTED_FILTER_ROW_STYLE}
        />
      ) : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-2 -right-2 rounded-base bg-black/5 opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      <span className="relative z-10 min-w-0 truncate">{label}</span>
    </button>
  );
}
