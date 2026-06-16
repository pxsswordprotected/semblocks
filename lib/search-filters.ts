export const BLOCK_TYPE_FILTERS = [
  "Image",
  "Text",
  "Link",
  "Media",
  "Attachment",
  "Embed",
] as const;

export type BlockTypeFilter = (typeof BLOCK_TYPE_FILTERS)[number];

export const DATE_ADDED_FILTER_PRESETS = [
  "any",
  "past_week",
  "past_month",
  "past_year",
  "custom",
] as const;

export type DateAddedFilterPreset = (typeof DATE_ADDED_FILTER_PRESETS)[number];

export type DateAddedFilter = {
  preset: DateAddedFilterPreset;
  from?: string | null;
  to?: string | null;
};

export type DateAddedRange = {
  from: string;
  to?: string;
};

export type SearchFilterOptions = {
  blockTypes?: readonly BlockTypeFilter[] | null;
  dateAdded?: DateAddedFilter | null;
};

export const EMPTY_DATE_ADDED_FILTER: DateAddedFilter = {
  preset: "any",
};

export const EMPTY_SEARCH_FILTER_OPTIONS: SearchFilterOptions = {
  blockTypes: [],
  dateAdded: EMPTY_DATE_ADDED_FILTER,
};

export type SearchFilterApiParams = {
  types?: string;
  date?: Exclude<DateAddedFilterPreset, "any">;
  dateFrom?: string;
  dateTo?: string;
};

export type SearchFilterApiBody = {
  types?: readonly BlockTypeFilter[];
  date?: { preset: Exclude<DateAddedFilterPreset, "any">; from?: string; to?: string };
};

const BLOCK_TYPE_BY_LOWER = new Map<string, BlockTypeFilter>(
  BLOCK_TYPE_FILTERS.map((type) => [type.toLowerCase(), type]),
);

const BLOCK_TYPE_ORDER = new Map<BlockTypeFilter, number>(
  BLOCK_TYPE_FILTERS.map((type, index) => [type, index]),
);

const DATE_PRESET_BY_LOWER = new Map<string, DateAddedFilterPreset>(
  DATE_ADDED_FILTER_PRESETS.map((preset) => [preset.toLowerCase(), preset]),
);

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class SearchFilterValidationError extends Error {
  readonly filter = "types";

  constructor(message = "Invalid search filter") {
    super(message);
    this.name = "SearchFilterValidationError";
  }
}

function canonicalBlockType(raw: string): BlockTypeFilter | null {
  return BLOCK_TYPE_BY_LOWER.get(raw.trim().toLowerCase()) ?? null;
}

function canonicalDatePreset(raw: string): DateAddedFilterPreset | null {
  return DATE_PRESET_BY_LOWER.get(raw.trim().toLowerCase()) ?? null;
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

export function isDateOnlyString(raw: string): boolean {
  const match = DATE_ONLY_RE.exec(raw);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}


function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDateParts(date: Date, parts: { days?: number; months?: number; years?: number }): Date {
  const next = startOfUtcDate(date);
  if (parts.years) next.setUTCFullYear(next.getUTCFullYear() + parts.years);
  if (parts.months) next.setUTCMonth(next.getUTCMonth() + parts.months);
  if (parts.days) next.setUTCDate(next.getUTCDate() + parts.days);
  return next;
}

export function resolveDateAddedRange(
  filter: DateAddedFilter | null | undefined,
  now = new Date(),
): DateAddedRange | null {
  const normalized = normalizeDateAddedFilter(filter);
  switch (normalized.preset) {
    case "past_week":
      return { from: formatUtcDate(addUtcDateParts(now, { days: -7 })) };
    case "past_month":
      return { from: formatUtcDate(addUtcDateParts(now, { months: -1 })) };
    case "past_year":
      return { from: formatUtcDate(addUtcDateParts(now, { years: -1 })) };
    case "custom":
      return { from: normalized.from ?? "", to: normalized.to ?? "" };
    case "any":
      return null;
  }
}
function normalizeDateOnly(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return isDateOnlyString(trimmed) ? trimmed : null;
}

function normalizeDateAddedFilter(filter: DateAddedFilter | null | undefined): DateAddedFilter {
  if (!filter || filter.preset === "any") return EMPTY_DATE_ADDED_FILTER;
  if (filter.preset !== "custom") return { preset: filter.preset };

  const from = filter.from ?? null;
  const to = filter.to ?? null;
  if (!from || !to || !isDateOnlyString(from) || !isDateOnlyString(to) || from > to) {
    return EMPTY_DATE_ADDED_FILTER;
  }
  return { preset: "custom", from, to };
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

export function parseDateAddedFilterLenient(params: {
  date: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): DateAddedFilter {
  if (!params.date) return EMPTY_DATE_ADDED_FILTER;
  const preset = canonicalDatePreset(params.date);
  if (!preset || preset === "any") return EMPTY_DATE_ADDED_FILTER;
  if (preset !== "custom") return { preset };

  const from = normalizeDateOnly(params.dateFrom);
  const to = normalizeDateOnly(params.dateTo);
  if (!from || !to || from > to) return EMPTY_DATE_ADDED_FILTER;
  return { preset: "custom", from, to };
}

function normalizeStrictTypeParts(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  if (typeof raw === "string") return stringParts(raw);
  if (!Array.isArray(raw)) throw new SearchFilterValidationError("Invalid search filter: types");

  const parts: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") throw new SearchFilterValidationError("Invalid search filter: types");
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
    if (!type) throw new SearchFilterValidationError("Invalid search filter: types");
    valid.push(type);
  }
  return orderedUnique(valid);
}

export function parseDateAddedFilterStrict(raw: {
  date?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
}): DateAddedFilter {
  const date = raw.date;
  if (date == null || date === "") return EMPTY_DATE_ADDED_FILTER;
  if (typeof date !== "string") throw new SearchFilterValidationError("Invalid search filter: date");

  const preset = canonicalDatePreset(date);
  if (!preset) throw new SearchFilterValidationError("Invalid search filter: date");
  if (preset === "any") return EMPTY_DATE_ADDED_FILTER;
  if (preset !== "custom") return { preset };

  const from = normalizeDateOnly(raw.dateFrom);
  const to = normalizeDateOnly(raw.dateTo);
  if (!from || !to || from > to) {
    throw new SearchFilterValidationError("Invalid search filter: date");
  }
  return { preset: "custom", from, to };
}

function parseBodyDateFilter(body: { date?: unknown; dateFrom?: unknown; dateTo?: unknown }): DateAddedFilter {
  const raw = body.date;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = raw as { preset?: unknown; from?: unknown; to?: unknown };
    return parseDateAddedFilterStrict({
      date: value.preset,
      dateFrom: value.from,
      dateTo: value.to,
    });
  }
  return parseDateAddedFilterStrict(body);
}

export function parseSearchFiltersFromApiQuery(
  params: URLSearchParams,
): SearchFilterOptions {
  return {
    blockTypes: parseBlockTypeFiltersStrict(params.get("types")),
    dateAdded: parseDateAddedFilterStrict({
      date: params.get("date"),
      dateFrom: params.get("dateFrom"),
      dateTo: params.get("dateTo"),
    }),
  };
}

export function parseSearchFiltersFromApiBody(body: {
  types?: unknown;
  date?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
}): SearchFilterOptions {
  return {
    blockTypes: parseBlockTypeFiltersStrict(body.types),
    dateAdded: parseBodyDateFilter(body),
  };
}

export function searchFiltersToApiParams(filters: SearchFilterOptions): SearchFilterApiParams {
  const blockTypes = filters.blockTypes ?? [];
  const dateAdded = normalizeDateAddedFilter(filters.dateAdded);
  const params: SearchFilterApiParams = {};

  if (blockTypes.length > 0) params.types = blockTypes.join(",");
  if (dateAdded.preset !== "any") {
    params.date = dateAdded.preset;
    if (dateAdded.preset === "custom") {
      params.dateFrom = dateAdded.from ?? undefined;
      params.dateTo = dateAdded.to ?? undefined;
    }
  }
  return params;
}

export function searchFiltersToApiBody(filters: SearchFilterOptions): SearchFilterApiBody {
  const blockTypes = filters.blockTypes ?? [];
  const dateAdded = normalizeDateAddedFilter(filters.dateAdded);
  const body: SearchFilterApiBody = {};

  if (blockTypes.length > 0) body.types = blockTypes;
  if (dateAdded.preset !== "any") {
    body.date =
      dateAdded.preset === "custom"
        ? { preset: "custom", from: dateAdded.from ?? undefined, to: dateAdded.to ?? undefined }
        : { preset: dateAdded.preset };
  }
  return body;
}

export function searchFiltersCacheKey(filters: SearchFilterOptions): string {
  const blockTypes = filters.blockTypes ?? [];
  const dateAdded = normalizeDateAddedFilter(filters.dateAdded);
  const dateKey =
    dateAdded.preset === "custom"
      ? `date:custom:${dateAdded.from}:${dateAdded.to}`
      : `date:${dateAdded.preset}`;
  return `types:${blockTypes.join(",")}|${dateKey}`;
}
