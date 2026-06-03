import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  MIN_RESULT_LIMIT,
  VISIBLE_ROWS_PER_PAGE,
  parseResultLimitDraft,
} from "./resultLimit.ts";

test("result limit defaults preserve eight-row page cadence", () => {
  assert.equal(VISIBLE_ROWS_PER_PAGE, 8);
  assert.equal(DEFAULT_RESULT_LIMIT, 104);
  assert.equal(DEFAULT_RESULT_LIMIT / VISIBLE_ROWS_PER_PAGE, 13);
});

test("parseResultLimitDraft accepts integers and clamps to bounds", () => {
  assert.equal(parseResultLimitDraft("40"), 40);
  assert.equal(parseResultLimitDraft(" 40 "), 40);
  assert.equal(parseResultLimitDraft("1"), MIN_RESULT_LIMIT);
  assert.equal(parseResultLimitDraft(String(MAX_RESULT_LIMIT + 1)), MAX_RESULT_LIMIT);
});

test("parseResultLimitDraft rejects empty, unsafe, and non-numeric drafts", () => {
  assert.equal(parseResultLimitDraft(""), null);
  assert.equal(parseResultLimitDraft("   "), null);
  assert.equal(parseResultLimitDraft("12px"), null);
  assert.equal(parseResultLimitDraft("1.5"), null);
  assert.equal(parseResultLimitDraft(String(Number.MAX_SAFE_INTEGER + 1)), null);
});
