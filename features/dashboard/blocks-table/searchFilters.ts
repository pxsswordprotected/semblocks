import {
  BLOCK_TYPE_FILTERS,
  EMPTY_SEARCH_FILTER_OPTIONS,
  parseBlockTypeFiltersLenient,
  searchFiltersCacheKey,
  searchFiltersToApiBody,
  searchFiltersToApiParams,
} from "../../../lib/search-filters.ts";
import type {
  BlockTypeFilter,
  SearchFilterOptions,
} from "../../../lib/search-filters.ts";

export type SearchFilters = {
  blockTypes: readonly BlockTypeFilter[];
};

type SearchParamReader = Pick<URLSearchParams, "get">;

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  blockTypes: EMPTY_SEARCH_FILTER_OPTIONS.blockTypes ?? [],
};

export function parseSearchFilters(params: SearchParamReader): SearchFilters {
  return {
    blockTypes: parseBlockTypeFiltersLenient(params.get("types")),
  };
}

export function toggleBlockTypeFilter(
  filters: SearchFilters,
  blockType: BlockTypeFilter,
): SearchFilters {
  const selected = new Set(filters.blockTypes);
  if (selected.has(blockType)) selected.delete(blockType);
  else selected.add(blockType);

  return {
    blockTypes: BLOCK_TYPE_FILTERS.filter((type) => selected.has(type)),
  };
}

export function searchFiltersEqual(
  a: SearchFilters,
  b: SearchFilters,
): boolean {
  return searchFiltersKey(a) === searchFiltersKey(b);
}

export function serializeSearchFilters(
  params: URLSearchParams,
  filters: SearchFilters,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const before = searchFiltersToApiParams(parseSearchFilters(next));
  const after = searchFiltersToApiParams(filters);

  if (after) next.set("types", after);
  else next.delete("types");

  if (before !== after) next.delete("page");
  return next;
}

export function appendSearchFiltersToParams(
  params: URLSearchParams,
  filters: SearchFilters,
): void {
  const types = searchFiltersToApiParams(filters);
  if (types) params.set("types", types);
}

export function searchFiltersToRequestBody(
  filters: SearchFilters,
): { types?: readonly BlockTypeFilter[] } {
  return searchFiltersToApiBody(filters);
}

export function searchFiltersKey(filters: SearchFilterOptions): string {
  return searchFiltersCacheKey(filters);
}
