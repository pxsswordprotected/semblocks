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
} from "@floating-ui/react";
import { useState } from "react";
import { CalendarBlank } from "@phosphor-icons/react/dist/ssr";
import { DayPicker, type DateRange } from "react-day-picker";
import Button from "@/components/Button";
import { cn } from "@/lib/utils";

type DateRangeValue = {
  from?: string | null;
  to?: string | null;
};

type DateRangePickerProps = {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
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

function formatRange(value: DateRangeValue): string {
  if (value.from && value.to) return `${value.from} → ${value.to}`;
  if (value.from) return `${value.from} → …`;
  return "Pick date range";
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const selected: DateRange = {
    from: dateFromDateOnly(value.from),
    to: dateFromDateOnly(value.to),
  };

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
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

  function selectRange(next: DateRange | undefined) {
    onChange({
      from: next?.from ? dateOnlyFromDate(next.from) : null,
      to: next?.to ? dateOnlyFromDate(next.to) : null,
    });
  }

  return (
    <>
      <Button
        ref={refs.setReference}
        type="button"
        variant="muted"
        className="h-8 w-full justify-start gap-2 px-2 py-0 text-left font-normal"
        {...getReferenceProps()}
      >
        <CalendarBlank size={16} weight="bold" aria-hidden="true" />
        <span className="truncate">{formatRange(value)}</span>
      </Button>
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
              selected={selected}
              onSelect={selectRange}
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
