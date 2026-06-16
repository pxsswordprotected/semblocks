export const MIN_SEARCH_LIMIT = 1;
export const MAX_SEARCH_LIMIT = 500;
export const DEFAULT_SEARCH_LIMIT = 104;

export function clampSearchLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(
    Math.max(Math.floor(value), MIN_SEARCH_LIMIT),
    MAX_SEARCH_LIMIT,
  );
}

export function parseSearchLimitParam(raw: string | null): number {
  if (raw == null || raw.trim() === "") return DEFAULT_SEARCH_LIMIT;
  return clampSearchLimit(Number(raw));
}
