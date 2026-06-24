"use client";

import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { FilterOptionButton } from "./FilterOptionButton";

type DateRangeValue = {
  from?: string | null;
  to?: string | null;
};

type DateRangePickerProps = {
  selected: boolean;
  value: DateRangeValue;
  onActivate: () => void;
  onChange: (next: DateRangeValue) => void;
  readOnly?: boolean;
};

function dateFromDateOnly(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function dateOnlyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRangeLabel(selected: boolean, value: DateRangeValue): string {
  if (!selected) return "Custom date range";
  if (value.from && value.to) return `${value.from} → ${value.to}`;
  if (value.from) return `${value.from} → …`;
  return "Custom date range";
}

export function DateRangePicker({
  selected: optionSelected,
  value,
  onActivate,
  onChange,
  readOnly = false,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedRange: DateRange = {
    from: dateFromDateOnly(value.from),
    to: dateFromDateOnly(value.to),
  };
  const today = new Date();
  const todayDateOnly = dateOnlyFromDate(today);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    strategy: "fixed",
  });
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: true });
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    dismiss,
    role,
  ]);

  function togglePicker() {
    if (readOnly) return;
    if (open) {
      setOpen(false);
      return;
    }
    onActivate();
    setOpen(true);
  }

  function selectRange(next: DateRange | undefined) {
    const from = next?.from ? dateOnlyFromDate(next.from) : null;
    const to = next?.to ? dateOnlyFromDate(next.to) : null;
    if ((from && from > todayDateOnly) || (to && to > todayDateOnly)) return;

    onChange({ from, to });
  }

  return (
    <>
      <FilterOptionButton
        ref={refs.setReference}
        selected={optionSelected}
        aria-disabled={readOnly}
        aria-expanded={open}
        {...getReferenceProps({ onClick: readOnly ? undefined : togglePicker })}
      >
        {formatRangeLabel(optionSelected, value)}
      </FilterOptionButton>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            data-filter-popover="date-range"
            className={cn(
              "z-50 rounded-base border border-stroke bg-dashboard p-3 font-sans text-neutral-800 shadow-base",
              "bg-[image:var(--gradient-panel)]",
            )}
            {...getFloatingProps()}
          >
            <DayPicker
              mode="range"
              selected={selectedRange}
              onSelect={selectRange}
              disabled={{ after: today }}
              endMonth={today}
              excludeDisabled
              numberOfMonths={1}
              classNames={{
                root: "text-sm",
                months: "relative",
                month: "space-y-3",
                month_caption: "flex h-7 items-center justify-center font-bold",
                nav: "absolute inset-x-0 top-0 z-10 flex h-7 items-center justify-between",
                button_previous: "flex h-7 w-7 items-center justify-center rounded-base hover:bg-black/5",
                button_next: "flex h-7 w-7 items-center justify-center rounded-base hover:bg-black/5",
                weekdays: "grid grid-cols-7 text-xs text-black/50",
                weekday: "flex h-7 items-center justify-center font-normal",
                week: "grid grid-cols-7",
                day: "relative flex h-8 w-8 items-center justify-center text-center",
                day_button: "h-7 w-7 rounded-base text-sm hover:bg-black/5 disabled:opacity-30",
                selected: "text-white [&>button]:bg-neutral-800",
                range_start: "text-white [&>button]:bg-neutral-800",
                range_end: "text-white [&>button]:bg-neutral-800",
                range_middle: "[&>button]:bg-black/10",
                today: "font-bold",
                outside: "text-black/30",
                disabled: "text-black/20",
              }}
            />
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
