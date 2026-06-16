"use client";

import type {
  DateAddedFilter as DateAddedFilterValue,
  DateAddedFilterPreset,
} from "@/lib/search-filters";
import { FilterDisclosure } from "./FilterDisclosure";
import { FilterOptionButton } from "./FilterOptionButton";
import { DateRangePicker } from "./DateRangePicker";

type DateAddedFilterProps = {
  value: DateAddedFilterValue;
  onChange: (next: DateAddedFilterValue) => void;
};

type DatePresetOption = {
  preset: Exclude<DateAddedFilterPreset, "custom">;
  label: string;
};

const DATE_PRESET_OPTIONS: readonly DatePresetOption[] = [
  { preset: "any", label: "Any time" },
  { preset: "past_week", label: "Past week" },
  { preset: "past_month", label: "Past month" },
  { preset: "past_year", label: "Past year" },
];

export function DateAddedFilter({ value, onChange }: DateAddedFilterProps) {
  function selectPreset(preset: DatePresetOption["preset"]) {
    onChange({ preset });
  }

  function activateCustomRange() {
    onChange({
      preset: "custom",
      from: value.preset === "custom" ? value.from ?? null : null,
      to: value.preset === "custom" ? value.to ?? null : null,
    });
  }

  function changeCustomRange(next: { from?: string | null; to?: string | null }) {
    onChange({
      preset: "custom",
      from: next.from ?? null,
      to: next.to ?? null,
    });
  }

  const customSelected = value.preset === "custom";

  return (
    <FilterDisclosure title="Date added" controlsId="date-added-filter-options">
      {DATE_PRESET_OPTIONS.map((option) => (
        <FilterOptionButton
          key={option.preset}
          selected={value.preset === option.preset}
          onClick={() => selectPreset(option.preset)}
        >
          {option.label}
        </FilterOptionButton>
      ))}
      <DateRangePicker
        selected={customSelected}
        value={customSelected ? value : {}}
        onActivate={activateCustomRange}
        onChange={changeCustomRange}
      />
    </FilterDisclosure>
  );
}
