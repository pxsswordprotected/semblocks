import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendSearchFiltersToParams,
  parseSearchFilters,
  searchFiltersKey,
  serializeSearchFilters,
} from "./searchFilters.ts";

test("parseSearchFilters returns empty filters for no params", () => {
  assert.deepEqual(parseSearchFilters(new URLSearchParams()), { blockTypes: [] });
});

test("parseSearchFilters parses canonical block types", () => {
  const filters = parseSearchFilters(new URLSearchParams("types=Image,Link"));
  assert.deepEqual(filters, { blockTypes: ["Image", "Link"] });
});

test("parseSearchFilters trims, canonicalizes case, and deduplicates", () => {
  const filters = parseSearchFilters(
    new URLSearchParams("types=image,%20Link,IMAGE,text"),
  );
  assert.deepEqual(filters, { blockTypes: ["Image", "Text", "Link"] });
});

test("parseSearchFilters ignores unknown URL values", () => {
  const filters = parseSearchFilters(new URLSearchParams("types=Image,Bad,Embed"));
  assert.deepEqual(filters, { blockTypes: ["Image", "Embed"] });
});

test("serializeSearchFilters writes types only when non-empty", () => {
  const params = serializeSearchFilters(new URLSearchParams("q=test"), {
    blockTypes: ["Image", "Link"],
  });
  assert.equal(params.get("types"), "Image,Link");
  assert.equal(params.get("q"), "test");
});

test("serializeSearchFilters removes empty types and resets page on change", () => {
  const params = serializeSearchFilters(
    new URLSearchParams("q=test&types=Image&page=3"),
    { blockTypes: [] },
  );
  assert.equal(params.has("types"), false);
  assert.equal(params.has("page"), false);
});

test("serializeSearchFilters keeps page when filters do not change", () => {
  const params = serializeSearchFilters(
    new URLSearchParams("q=test&types=image&page=3"),
    { blockTypes: ["Image"] },
  );
  assert.equal(params.get("types"), "Image");
  assert.equal(params.get("page"), "3");
});

test("appendSearchFiltersToParams omits empty filters", () => {
  const params = new URLSearchParams("q=test");
  appendSearchFiltersToParams(params, { blockTypes: [] });
  assert.equal(params.has("types"), false);
});

test("searchFiltersKey is stable and distinguishes values", () => {
  assert.equal(searchFiltersKey({ blockTypes: [] }), "types:");
  assert.equal(searchFiltersKey({ blockTypes: ["Image"] }), "types:Image");
  assert.notEqual(
    searchFiltersKey({ blockTypes: ["Image"] }),
    searchFiltersKey({ blockTypes: ["Link"] }),
  );
});
