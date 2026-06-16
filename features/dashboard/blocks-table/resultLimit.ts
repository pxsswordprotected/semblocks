export const VISIBLE_ROWS_PER_PAGE = 8;
export {
  DEFAULT_SEARCH_LIMIT as DEFAULT_RESULT_LIMIT,
  MAX_SEARCH_LIMIT as MAX_RESULT_LIMIT,
  MIN_SEARCH_LIMIT as MIN_RESULT_LIMIT,
  clampSearchLimit as clampResultLimit,
  parseSearchLimitParam as parseResultLimitParam,
} from "../../../lib/search-limits.ts";
