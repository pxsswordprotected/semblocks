import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_SEARCH_LIMIT, parseChannelFilter, parseLimit } from "./search-core.ts";
import {
  SearchFilterValidationError,
  parseSearchFiltersFromApiBody,
  parseSearchFiltersFromApiQuery,
  resolveDateAddedRange,
} from "./search-filters.ts";

test("returns null for absent channel filters", () => {
  assert.equal(parseChannelFilter(null), null);
  assert.equal(parseChannelFilter(undefined), null);
});

test("parses CSV strings to positive integer arrays", () => {
  assert.deepEqual(parseChannelFilter("1, 2,003"), [1, 2, 3]);
});

test("parses arrays of strings and numbers", () => {
  assert.deepEqual(parseChannelFilter(["1", 2, " 3 "]), [1, 2, 3]);
});

test("discards invalid, zero, negative, and non-integer values", () => {
  assert.deepEqual(parseChannelFilter(["invalid", "", 0, -1, 2.5, "3.14", 4]), [4]);
  assert.equal(parseChannelFilter("invalid,0,-1,2.5"), null);
});

test("deduplicates channel ids while preserving first occurrence", () => {
  assert.deepEqual(parseChannelFilter([2, 1, "2", "1", 3]), [2, 1, 3]);
});

test("returns null for unsupported raw types", () => {
  assert.equal(parseChannelFilter(true), null);
  assert.equal(parseChannelFilter({ channels: [1] }), null);
});

test("parseLimit clamps search result limits to the supported range", () => {
  assert.equal(parseLimit(null), 10);
  assert.equal(parseLimit("104"), 104);
  assert.equal(parseLimit("0"), 1);
  assert.equal(parseLimit("9999"), MAX_SEARCH_LIMIT);
  assert.equal(MAX_SEARCH_LIMIT, 500);
});

test("server search filter parser returns empty options when absent", () => {
  assert.deepEqual(parseSearchFiltersFromApiQuery(new URLSearchParams()), {
    blockTypes: [],
    dateAdded: { preset: "any" },
  });
  assert.deepEqual(parseSearchFiltersFromApiBody({}), {
    blockTypes: [],
    dateAdded: { preset: "any" },
  });
});

test("server search filter parser accepts valid and repeated block types", () => {
  assert.deepEqual(
    parseSearchFiltersFromApiQuery(new URLSearchParams("types=Image,Link,Image")),
    { blockTypes: ["Image", "Link"], dateAdded: { preset: "any" } },
  );
  assert.deepEqual(parseSearchFiltersFromApiBody({ types: ["text", "Image"] }), {
    blockTypes: ["Image", "Text"],
    dateAdded: { preset: "any" },
  });
});

test("server search filter parser rejects unsupported block types", () => {
  assert.throws(
    () => parseSearchFiltersFromApiQuery(new URLSearchParams("types=Image,Bad")),
    SearchFilterValidationError,
  );
  assert.throws(
    () => parseSearchFiltersFromApiBody({ types: ["Image", "Bad"] }),
    SearchFilterValidationError,
  );
});

test("server search filter parser rejects unsupported raw types", () => {
  assert.throws(
    () => parseSearchFiltersFromApiBody({ types: { value: "Image" } }),
    SearchFilterValidationError,
  );
  assert.throws(
    () => parseSearchFiltersFromApiBody({ types: [1] }),
    SearchFilterValidationError,
  );
});

test("server search filter parser accepts date presets and custom ranges", () => {
  assert.deepEqual(
    parseSearchFiltersFromApiQuery(new URLSearchParams("date=past_week")),
    { blockTypes: [], dateAdded: { preset: "past_week" } },
  );
  assert.deepEqual(
    parseSearchFiltersFromApiQuery(
      new URLSearchParams("date=custom&dateFrom=2026-01-01&dateTo=2026-06-15"),
    ),
    {
      blockTypes: [],
      dateAdded: { preset: "custom", from: "2026-01-01", to: "2026-06-15" },
    },
  );
  assert.deepEqual(
    parseSearchFiltersFromApiBody({
      date: { preset: "custom", from: "2026-01-01", to: "2026-06-15" },
    }),
    {
      blockTypes: [],
      dateAdded: { preset: "custom", from: "2026-01-01", to: "2026-06-15" },
    },
  );
});

test("server search filter parser rejects invalid date filters", () => {
  assert.throws(
    () => parseSearchFiltersFromApiQuery(new URLSearchParams("date=nope")),
    SearchFilterValidationError,
  );
  assert.throws(
    () => parseSearchFiltersFromApiQuery(new URLSearchParams("date=custom")),
    SearchFilterValidationError,
  );
  assert.throws(
    () =>
      parseSearchFiltersFromApiQuery(
        new URLSearchParams("date=custom&dateFrom=2026-06-15&dateTo=2026-01-01"),
      ),
    SearchFilterValidationError,
  );
  assert.throws(
    () =>
      parseSearchFiltersFromApiBody({
        date: { preset: "custom", from: "bad", to: "2026-06-15" },
      }),
    SearchFilterValidationError,
  );
});

test("resolveDateAddedRange resolves presets against UTC dates", () => {
  const now = new Date("2026-06-15T20:30:00Z");
  assert.deepEqual(resolveDateAddedRange({ preset: "past_week" }, now), {
    from: "2026-06-08",
  });
  assert.deepEqual(resolveDateAddedRange({ preset: "past_month" }, now), {
    from: "2026-05-15",
  });
  assert.deepEqual(resolveDateAddedRange({ preset: "past_year" }, now), {
    from: "2025-06-15",
  });
  assert.deepEqual(
    resolveDateAddedRange(
      { preset: "custom", from: "2026-01-01", to: "2026-06-15" },
      now,
    ),
    { from: "2026-01-01", to: "2026-06-15" },
  );
  assert.equal(resolveDateAddedRange({ preset: "any" }, now), null);
});
