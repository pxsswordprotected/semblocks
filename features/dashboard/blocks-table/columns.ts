// Single source of truth for the BlocksTable row grid template so
// the column header (BlocksTableCard) and each data row (BlockRow)
// share identical track widths.
export const BLOCK_GRID_COLUMNS =
  "4rem minmax(8rem, 1.2fr) 8rem minmax(10rem, 1fr) minmax(9rem, 2fr) 10rem";

export const BLOCK_GRID_CLASS =
  "grid gap-[clamp(0.75rem,1.2vw,1rem)] px-[clamp(1rem,1.8vw,1.5rem)]";
