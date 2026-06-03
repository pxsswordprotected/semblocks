export const VISIBLE_ROWS_PER_PAGE = 8;
export const DEFAULT_RESULT_LIMIT = 104;
export const MIN_RESULT_LIMIT = VISIBLE_ROWS_PER_PAGE;
export const MAX_RESULT_LIMIT = 500;

export function parseResultLimitDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return null;
  return Math.min(MAX_RESULT_LIMIT, Math.max(MIN_RESULT_LIMIT, parsed));
}
