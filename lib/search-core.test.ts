import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_SEARCH_LIMIT, parseChannelFilter, parseLimit } from "./search-core.ts";
import {
  SearchFilterValidationError,
  parseSearchFiltersFromApiBody,
  parseSearchFiltersFromApiQuery,
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
  });
  assert.deepEqual(parseSearchFiltersFromApiBody({}), { blockTypes: [] });
});

test("server search filter parser accepts valid and repeated block types", () => {
  assert.deepEqual(
    parseSearchFiltersFromApiQuery(new URLSearchParams("types=Image,Link,Image")),
    { blockTypes: ["Image", "Link"] },
  );
  assert.deepEqual(parseSearchFiltersFromApiBody({ types: ["text", "Image"] }), {
    blockTypes: ["Image", "Text"],
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
