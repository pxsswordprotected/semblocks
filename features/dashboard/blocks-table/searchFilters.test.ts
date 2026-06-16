import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendSearchFiltersToParams,
  parseSearchFilters,
  searchFiltersEqual,
  searchFiltersKey,
  serializeSearchFilters,
  toggleBlockTypeFilter,
} from "./searchFilters.ts";

const ANY_DATE = { preset: "any" } as const;

test("parseSearchFilters returns empty filters for no params", () => {
  assert.deepEqual(parseSearchFilters(new URLSearchParams()), {
    blockTypes: [],
    dateAdded: ANY_DATE,
  });
});

test("parseSearchFilters parses canonical block types", () => {
  const filters = parseSearchFilters(new URLSearchParams("types=Image,Link"));
  assert.deepEqual(filters, { blockTypes: ["Image", "Link"], dateAdded: ANY_DATE });
});

test("parseSearchFilters trims, canonicalizes case, and deduplicates", () => {
  const filters = parseSearchFilters(
    new URLSearchParams("types=image,%20Link,IMAGE,text"),
  );
  assert.deepEqual(filters, { blockTypes: ["Image", "Text", "Link"], dateAdded: ANY_DATE });
});

test("parseSearchFilters ignores unknown URL values", () => {
  const filters = parseSearchFilters(new URLSearchParams("types=Image,Bad,Embed"));
  assert.deepEqual(filters, { blockTypes: ["Image", "Embed"], dateAdded: ANY_DATE });
});

test("parseSearchFilters parses date presets and custom ranges", () => {
  assert.deepEqual(parseSearchFilters(new URLSearchParams("date=past_week")), {
    blockTypes: [],
    dateAdded: { preset: "past_week" },
  });
  assert.deepEqual(
    parseSearchFilters(
      new URLSearchParams("date=custom&dateFrom=2026-01-01&dateTo=2026-06-15"),
    ),
    {
      blockTypes: [],
      dateAdded: { preset: "custom", from: "2026-01-01", to: "2026-06-15" },
    },
  );
});

test("parseSearchFilters ignores invalid date URL values", () => {
  assert.deepEqual(parseSearchFilters(new URLSearchParams("date=nope")), {
    blockTypes: [],
    dateAdded: ANY_DATE,
  });
  assert.deepEqual(
    parseSearchFilters(
      new URLSearchParams("date=custom&dateFrom=2026-06-15&dateTo=2026-01-01"),
    ),
    { blockTypes: [], dateAdded: ANY_DATE },
  );
});

test("serializeSearchFilters writes types only when non-empty", () => {
  const params = serializeSearchFilters(new URLSearchParams("q=test"), {
    blockTypes: ["Image", "Link"],
  });
  assert.equal(params.get("types"), "Image,Link");
  assert.equal(params.get("q"), "test");
});

test("serializeSearchFilters writes and removes date filters", () => {
  const preset = serializeSearchFilters(new URLSearchParams("q=test"), {
    blockTypes: [],
    dateAdded: { preset: "past_month" },
  });
  assert.equal(preset.get("date"), "past_month");

  const custom = serializeSearchFilters(new URLSearchParams("q=test"), {
    blockTypes: [],
    dateAdded: { preset: "custom", from: "2026-01-01", to: "2026-06-15" },
  });
  assert.equal(custom.get("date"), "custom");
  assert.equal(custom.get("dateFrom"), "2026-01-01");
  assert.equal(custom.get("dateTo"), "2026-06-15");

  const removed = serializeSearchFilters(
    new URLSearchParams("q=test&date=custom&dateFrom=2026-01-01&dateTo=2026-06-15"),
    { blockTypes: [], dateAdded: ANY_DATE },
  );
  assert.equal(removed.has("date"), false);
  assert.equal(removed.has("dateFrom"), false);
  assert.equal(removed.has("dateTo"), false);
});

test("serializeSearchFilters removes empty types and resets page on change", () => {
  const params = serializeSearchFilters(
    new URLSearchParams("q=test&types=Image&page=3"),
    { blockTypes: [] },
  );
  assert.equal(params.has("types"), false);
  assert.equal(params.has("page"), false);
});

test("serializeSearchFilters resets page when date filter changes", () => {
  const params = serializeSearchFilters(
    new URLSearchParams("q=test&date=past_week&page=3"),
    { blockTypes: [], dateAdded: { preset: "past_month" } },
  );
  assert.equal(params.get("date"), "past_month");
  assert.equal(params.has("page"), false);
});

test("serializeSearchFilters keeps page when filters do not change", () => {
  const params = serializeSearchFilters(
    new URLSearchParams("q=test&types=image&date=past_week&page=3"),
    { blockTypes: ["Image"], dateAdded: { preset: "past_week" } },
  );
  assert.equal(params.get("types"), "Image");
  assert.equal(params.get("date"), "past_week");
  assert.equal(params.get("page"), "3");
});

test("appendSearchFiltersToParams omits empty filters", () => {
  const params = new URLSearchParams("q=test");
  appendSearchFiltersToParams(params, { blockTypes: [] });
  assert.equal(params.has("types"), false);
  assert.equal(params.has("date"), false);
});

test("appendSearchFiltersToParams writes date filters", () => {
  const params = new URLSearchParams("q=test");
  appendSearchFiltersToParams(params, {
    blockTypes: [],
    dateAdded: { preset: "custom", from: "2026-01-01", to: "2026-06-15" },
  });
  assert.equal(params.get("date"), "custom");
  assert.equal(params.get("dateFrom"), "2026-01-01");
  assert.equal(params.get("dateTo"), "2026-06-15");
});

test("searchFiltersKey is stable and distinguishes values", () => {
  assert.equal(searchFiltersKey({ blockTypes: [] }), "types:|date:any");
  assert.equal(searchFiltersKey({ blockTypes: ["Image"] }), "types:Image|date:any");
  assert.notEqual(
    searchFiltersKey({ blockTypes: ["Image"] }),
    searchFiltersKey({ blockTypes: ["Link"] }),
  );
  assert.notEqual(
    searchFiltersKey({ blockTypes: ["Image"], dateAdded: { preset: "past_week" } }),
    searchFiltersKey({ blockTypes: ["Image"], dateAdded: { preset: "past_month" } }),
  );
});

test("toggleBlockTypeFilter adds a block type when absent", () => {
  assert.deepEqual(toggleBlockTypeFilter({ blockTypes: [] }, "Image"), {
    blockTypes: ["Image"],
  });
});

test("toggleBlockTypeFilter removes a block type when present", () => {
  assert.deepEqual(toggleBlockTypeFilter({ blockTypes: ["Image"] }, "Image"), {
    blockTypes: [],
  });
});

test("toggleBlockTypeFilter preserves canonical ordering", () => {
  assert.deepEqual(toggleBlockTypeFilter({ blockTypes: ["Link"] }, "Image"), {
    blockTypes: ["Image", "Link"],
  });
  assert.deepEqual(
    toggleBlockTypeFilter({ blockTypes: ["Embed", "Text"] }, "Attachment"),
    { blockTypes: ["Text", "Attachment", "Embed"] },
  );
});

test("toggleBlockTypeFilter does not mutate the original filters object", () => {
  const original = { blockTypes: ["Link"] as const };
  const next = toggleBlockTypeFilter(original, "Image");

  assert.deepEqual(original, { blockTypes: ["Link"] });
  assert.deepEqual(next, { blockTypes: ["Image", "Link"] });
});

test("searchFiltersEqual compares canonical filter values", () => {
  assert.equal(
    searchFiltersEqual({ blockTypes: ["Image"] }, { blockTypes: ["Image"] }),
    true,
  );
  assert.equal(
    searchFiltersEqual({ blockTypes: ["Image"] }, { blockTypes: ["Link"] }),
    false,
  );
  assert.equal(
    searchFiltersEqual({ blockTypes: [] }, { blockTypes: [] }),
    true,
  );
  assert.equal(
    searchFiltersEqual(
      { blockTypes: [], dateAdded: { preset: "past_week" } },
      { blockTypes: [], dateAdded: { preset: "past_month" } },
    ),
    false,
  );
});

test("serializeSearchFilters drops unknown URL values on next serialization", () => {
  const params = serializeSearchFilters(
    new URLSearchParams("q=test&types=Image,Bad,Embed&date=nope"),
    { blockTypes: ["Image", "Embed"], dateAdded: ANY_DATE },
  );
  assert.equal(params.get("types"), "Image,Embed");
  assert.equal(params.has("date"), false);
});

test("serializeSearchFilters canonicalizes case and whitespace variants", () => {
  const params = serializeSearchFilters(
    new URLSearchParams("q=test&types=image,%20Link&date=PAST_WEEK"),
    { blockTypes: ["Image", "Link"], dateAdded: { preset: "past_week" } },
  );
  assert.equal(params.get("types"), "Image,Link");
  assert.equal(params.get("date"), "past_week");
});
