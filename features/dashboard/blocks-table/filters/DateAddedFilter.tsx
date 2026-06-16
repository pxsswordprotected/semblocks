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
  preset: DateAddedFilterPreset;
  label: string;
};

const DATE_PRESET_OPTIONS: readonly DatePresetOption[] = [
  { preset: "any", label: "Any time" },
  { preset: "past_week", label: "Past week" },
  { preset: "past_month", label: "Past month" },
  { preset: "past_year", label: "Past year" },
  { preset: "custom", label: "Custom date range" },
];

export function DateAddedFilter({ value, onChange }: DateAddedFilterProps) {
  function selectPreset(preset: DateAddedFilterPreset) {
    if (preset === "custom") {
      onChange({
        preset,
        from: value.preset === "custom" ? value.from ?? null : null,
        to: value.preset === "custom" ? value.to ?? null : null,
      });
      return;
    }
    onChange({ preset });
  }

  function changeCustomRange(next: { from?: string | null; to?: string | null }) {
    onChange({
      preset: "custom",
      from: next.from ?? null,
      to: next.to ?? null,
    });
  }

  return (
    <FilterDisclosure title="Date added" controlsId="date-added-filter-options">
      {DATE_PRESET_OPTIONS.map((option) => (
        <div key={option.preset} className="flex flex-col gap-2">
          <FilterOptionButton
            selected={value.preset === option.preset}
            onClick={() => selectPreset(option.preset)}
          >
            {option.label}
          </FilterOptionButton>
          {option.preset === "custom" && value.preset === "custom" ? (
            <DateRangePicker value={value} onChange={changeCustomRange} />
          ) : null}
        </div>
      ))}
    </FilterDisclosure>
  );
}
