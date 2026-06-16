import {
  BLOCK_TYPE_FILTERS,
  EMPTY_SEARCH_FILTER_OPTIONS,
  parseBlockTypeFiltersLenient,
  parseDateAddedFilterLenient,
  searchFiltersCacheKey,
  searchFiltersToApiBody,
  searchFiltersToApiParams,
} from "../../../lib/search-filters.ts";
import type {
  BlockTypeFilter,
  DateAddedFilter,
  SearchFilterApiBody,
  SearchFilterOptions,
} from "../../../lib/search-filters.ts";

export type SearchFilters = {
  blockTypes: readonly BlockTypeFilter[];
  dateAdded: DateAddedFilter;
};

type SearchParamReader = Pick<URLSearchParams, "get">;

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  blockTypes: EMPTY_SEARCH_FILTER_OPTIONS.blockTypes ?? [],
  dateAdded: EMPTY_SEARCH_FILTER_OPTIONS.dateAdded ?? { preset: "any" },
};

export function parseSearchFilters(params: SearchParamReader): SearchFilters {
  return {
    blockTypes: parseBlockTypeFiltersLenient(params.get("types")),
    dateAdded: parseDateAddedFilterLenient({
      date: params.get("date"),
      dateFrom: params.get("dateFrom"),
      dateTo: params.get("dateTo"),
    }),
  };
}

export function toggleBlockTypeFilter(
  filters: SearchFilters | Pick<SearchFilters, "blockTypes">,
  blockType: BlockTypeFilter,
): Pick<SearchFilters, "blockTypes"> {
  const selected = new Set(filters.blockTypes);
  if (selected.has(blockType)) selected.delete(blockType);
  else selected.add(blockType);

  return {
    blockTypes: BLOCK_TYPE_FILTERS.filter((type) => selected.has(type)),
  };
}

export function searchFiltersEqual(
  a: SearchFilterOptions,
  b: SearchFilterOptions,
): boolean {
  return searchFiltersKey(a) === searchFiltersKey(b);
}

export function serializeSearchFilters(
  params: URLSearchParams,
  filters: SearchFilterOptions,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const before = searchFiltersKey(parseSearchFilters(next));
  const after = searchFiltersKey(filters);
  const apiParams = searchFiltersToApiParams(filters);

  if (apiParams.types) next.set("types", apiParams.types);
  else next.delete("types");

  if (apiParams.date) next.set("date", apiParams.date);
  else next.delete("date");

  if (apiParams.dateFrom) next.set("dateFrom", apiParams.dateFrom);
  else next.delete("dateFrom");

  if (apiParams.dateTo) next.set("dateTo", apiParams.dateTo);
  else next.delete("dateTo");

  if (before !== after) next.delete("page");
  return next;
}

export function appendSearchFiltersToParams(
  params: URLSearchParams,
  filters: SearchFilterOptions,
): void {
  const apiParams = searchFiltersToApiParams(filters);
  if (apiParams.types) params.set("types", apiParams.types);
  if (apiParams.date) params.set("date", apiParams.date);
  if (apiParams.dateFrom) params.set("dateFrom", apiParams.dateFrom);
  if (apiParams.dateTo) params.set("dateTo", apiParams.dateTo);
}

export function searchFiltersToRequestBody(
  filters: SearchFilterOptions,
): SearchFilterApiBody {
  return searchFiltersToApiBody(filters);
}

export function searchFiltersKey(filters: SearchFilterOptions): string {
  return searchFiltersCacheKey(filters);
}
