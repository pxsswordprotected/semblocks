import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RESULT_LIMIT,
  VISIBLE_ROWS_PER_PAGE,
} from "./resultLimit.ts";

test("result limit defaults preserve eight-row page cadence", () => {
  assert.equal(VISIBLE_ROWS_PER_PAGE, 8);
  assert.equal(DEFAULT_RESULT_LIMIT, 104);
  assert.equal(DEFAULT_RESULT_LIMIT / VISIBLE_ROWS_PER_PAGE, 13);
});
