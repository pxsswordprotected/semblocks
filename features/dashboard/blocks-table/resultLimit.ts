import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  MIN_SEARCH_LIMIT,
  clampSearchLimit,
  parseSearchLimitParam,
} from "../../../lib/search-limits.ts";

export const VISIBLE_ROWS_PER_PAGE = 8;
export const DEFAULT_RESULT_LIMIT = DEFAULT_SEARCH_LIMIT;
export const MAX_RESULT_LIMIT = MAX_SEARCH_LIMIT;
export const MIN_RESULT_LIMIT = MIN_SEARCH_LIMIT;
export const clampResultLimit = clampSearchLimit;
export const parseResultLimitParam = parseSearchLimitParam;

export function effectiveResultLimit(
  requestedResultLimit: number,
  ownerMode: boolean,
): number {
  return ownerMode ? requestedResultLimit : DEFAULT_RESULT_LIMIT;
}
