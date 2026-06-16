import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

const SELECTED_FILTER_ROW_STYLE = {
  backgroundColor: "#141414",
  boxShadow: [
    "0 1px 1.7px rgb(0 0 0 / 0.19)",
    "inset 0 0 0 1px rgb(0 0 0 / 0.10)",
    "inset -1px -1px 3.6px rgb(245 245 245 / 0.82)",
    "inset 0 0 7.6px rgb(255 255 255 / 0.40)",
  ].join(", "),
} satisfies CSSProperties;

type FilterOptionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> & {
  selected: boolean;
  children: ReactNode;
};

export const FilterOptionButton = forwardRef<
  HTMLButtonElement,
  FilterOptionButtonProps
>(function FilterOptionButton(
  { selected, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      className={cn(
        "group relative flex w-full items-center rounded-base px-2 py-1 text-left text-sm leading-5 transition-colors",
        selected ? "text-white" : "text-neutral-800",
        className,
      )}
      {...rest}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-base"
          style={SELECTED_FILTER_ROW_STYLE}
        />
      ) : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-base bg-black/5 opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      <span className="relative z-10 min-w-0 truncate">{children}</span>
    </button>
  );
});
