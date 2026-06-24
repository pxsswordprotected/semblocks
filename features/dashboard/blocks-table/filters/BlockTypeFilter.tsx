"use client";

import {
  BLOCK_TYPE_FILTERS,
  type BlockTypeFilter as BlockTypeFilterValue,
} from "@/lib/search-filters";
import { toggleBlockTypeFilter } from "../searchFilters";
import { FilterDisclosure } from "./FilterDisclosure";
import { FilterOptionButton } from "./FilterOptionButton";

type BlockTypeFilterProps = {
  value: readonly BlockTypeFilterValue[];
  onChange: (next: readonly BlockTypeFilterValue[]) => void;
  readOnly?: boolean;
};

export function BlockTypeFilter({
  value,
  onChange,
  readOnly = false,
}: BlockTypeFilterProps) {
  function toggleType(blockType: BlockTypeFilterValue) {
    if (readOnly) return;
    const next = toggleBlockTypeFilter({ blockTypes: value }, blockType);
    onChange(next.blockTypes);
  }

  return (
    <FilterDisclosure title="Block types" controlsId="block-type-filter-options">
      {BLOCK_TYPE_FILTERS.map((blockType) => (
        <FilterOptionButton
          key={blockType}
          selected={value.includes(blockType)}
          aria-disabled={readOnly}
          onClick={readOnly ? undefined : () => toggleType(blockType)}
        >
          {blockType}
        </FilterOptionButton>
      ))}
    </FilterDisclosure>
  );
}
