"use client";

import { type CSSProperties } from "react";
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
  function toggleType(blockType: BlockTypeFilterValue) {
    const next = toggleBlockTypeFilter({ blockTypes: value }, blockType);
    onChange(next.blockTypes);
  }

  return (
    <>
      <div className="font-[Arial] text-base leading-5 text-neutral-800">
        Block types
      </div>
      <div className="mt-3 flex flex-col gap-1">
        {BLOCK_TYPE_FILTERS.map((blockType) => (
          <BlockTypeFilterOption
            key={blockType}
            label={blockType}
            selected={value.includes(blockType)}
            onClick={() => toggleType(blockType)}
          />
        ))}
      </div>
      <div className="mt-4 h-px w-full shrink-0 bg-stroke" />
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
