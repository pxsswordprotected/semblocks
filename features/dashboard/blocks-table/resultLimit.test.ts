import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  MIN_RESULT_LIMIT,
  VISIBLE_ROWS_PER_PAGE,
  clampResultLimit,
  parseResultLimitParam,
} from "./resultLimit.ts";

test("result limit defaults preserve eight-row page cadence", () => {
  assert.equal(VISIBLE_ROWS_PER_PAGE, 8);
  assert.equal(DEFAULT_RESULT_LIMIT, 104);
  assert.equal(DEFAULT_RESULT_LIMIT / VISIBLE_ROWS_PER_PAGE, 13);
});

test("result limit parser defaults empty values", () => {
  assert.equal(parseResultLimitParam(null), DEFAULT_RESULT_LIMIT);
  assert.equal(parseResultLimitParam(""), DEFAULT_RESULT_LIMIT);
  assert.equal(parseResultLimitParam("   "), DEFAULT_RESULT_LIMIT);
});

test("result limit parser clamps to the supported range", () => {
  assert.equal(MIN_RESULT_LIMIT, 1);
  assert.equal(MAX_RESULT_LIMIT, 500);
  assert.equal(parseResultLimitParam("8"), 8);
  assert.equal(parseResultLimitParam("32"), 32);
  assert.equal(parseResultLimitParam("500"), 500);
  assert.equal(parseResultLimitParam("999"), MAX_RESULT_LIMIT);
  assert.equal(parseResultLimitParam("0"), MIN_RESULT_LIMIT);
  assert.equal(parseResultLimitParam("-3"), MIN_RESULT_LIMIT);
});

test("result limit parser floors fractional values and rejects invalid values", () => {
  assert.equal(parseResultLimitParam("12.9"), 12);
  assert.equal(parseResultLimitParam("abc"), DEFAULT_RESULT_LIMIT);
  assert.equal(clampResultLimit(Number.NaN), DEFAULT_RESULT_LIMIT);
});
