import assert from "node:assert/strict";
import test from "node:test";
import { safeExternalHref } from "./safe-url.ts";

test("safeExternalHref permits only absolute HTTP(S) URLs", () => {
  assert.equal(safeExternalHref("https://example.com/path"), "https://example.com/path");
  assert.equal(safeExternalHref("http://example.com/path"), "http://example.com/path");
  assert.equal(safeExternalHref("javascript:alert(1)"), null);
  assert.equal(safeExternalHref("data:text/html,hi"), null);
  assert.equal(safeExternalHref("/relative"), null);
  assert.equal(safeExternalHref("not a url"), null);
});
