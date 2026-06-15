export const BLOCK_TYPE_FILTERS = [
  "Image",
  "Text",
  "Link",
  "Media",
  "Attachment",
  "Embed",
] as const;

export type BlockTypeFilter = (typeof BLOCK_TYPE_FILTERS)[number];

export type SearchFilterOptions = {
  blockTypes?: readonly BlockTypeFilter[] | null;
};

export const EMPTY_SEARCH_FILTER_OPTIONS: SearchFilterOptions = {
  blockTypes: [],
};

const BLOCK_TYPE_BY_LOWER = new Map<string, BlockTypeFilter>(
  BLOCK_TYPE_FILTERS.map((type) => [type.toLowerCase(), type]),
);

const BLOCK_TYPE_ORDER = new Map<BlockTypeFilter, number>(
  BLOCK_TYPE_FILTERS.map((type, index) => [type, index]),
);

export class SearchFilterValidationError extends Error {
  readonly filter = "types";

  constructor(message = "Invalid search filter: types") {
    super(message);
    this.name = "SearchFilterValidationError";
  }
}

function canonicalBlockType(raw: string): BlockTypeFilter | null {
  return BLOCK_TYPE_BY_LOWER.get(raw.trim().toLowerCase()) ?? null;
}

function orderedUnique(types: Iterable<BlockTypeFilter>): BlockTypeFilter[] {
  const unique = new Set<BlockTypeFilter>();
  for (const type of types) unique.add(type);
  return [...unique].sort(
    (a, b) => (BLOCK_TYPE_ORDER.get(a) ?? 0) - (BLOCK_TYPE_ORDER.get(b) ?? 0),
  );
}

function stringParts(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseBlockTypeFiltersLenient(raw: string | null): BlockTypeFilter[] {
  if (!raw) return [];
  const valid: BlockTypeFilter[] = [];
  for (const part of stringParts(raw)) {
    const type = canonicalBlockType(part);
    if (type) valid.push(type);
  }
  return orderedUnique(valid);
}

function normalizeStrictTypeParts(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  if (typeof raw === "string") return stringParts(raw);
  if (!Array.isArray(raw)) throw new SearchFilterValidationError();

  const parts: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") throw new SearchFilterValidationError();
    const trimmed = value.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts;
}

export function parseBlockTypeFiltersStrict(raw: unknown): BlockTypeFilter[] {
  const parts = normalizeStrictTypeParts(raw);
  const valid: BlockTypeFilter[] = [];
  for (const part of parts) {
    const type = canonicalBlockType(part);
    if (!type) throw new SearchFilterValidationError();
    valid.push(type);
  }
  return orderedUnique(valid);
}

export function parseSearchFiltersFromApiQuery(
  params: URLSearchParams,
): SearchFilterOptions {
  return {
    blockTypes: parseBlockTypeFiltersStrict(params.get("types")),
  };
}

export function parseSearchFiltersFromApiBody(body: {
  types?: unknown;
}): SearchFilterOptions {
  return {
    blockTypes: parseBlockTypeFiltersStrict(body.types),
  };
}

export function searchFiltersToApiParams(filters: SearchFilterOptions): string {
  const blockTypes = filters.blockTypes ?? [];
  return blockTypes.length > 0 ? blockTypes.join(",") : "";
}

export function searchFiltersToApiBody(filters: SearchFilterOptions): {
  types?: readonly BlockTypeFilter[];
} {
  const blockTypes = filters.blockTypes ?? [];
  return blockTypes.length > 0 ? { types: blockTypes } : {};
}

export function searchFiltersCacheKey(filters: SearchFilterOptions): string {
  const blockTypes = filters.blockTypes ?? [];
  return blockTypes.length > 0 ? `types:${blockTypes.join(",")}` : "types:";
}
