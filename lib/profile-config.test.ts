import assert from "node:assert/strict";
import test from "node:test";
import {
  getConfiguredArenaProfile,
  normalizeArenaProfileSlug,
  profileUrl,
} from "./profile-config.ts";

test("normalizeArenaProfileSlug accepts slugs and Are.na profile URLs", () => {
  assert.equal(normalizeArenaProfileSlug("Example-User"), "example-user");
  assert.equal(
    normalizeArenaProfileSlug("https://www.are.na/example-user/channels"),
    "example-user",
  );
  assert.equal(
    normalizeArenaProfileSlug("https://are.na/example-user"),
    "example-user",
  );
});

test("normalizeArenaProfileSlug rejects empty, non-Are.na, and invalid values", () => {
  assert.equal(normalizeArenaProfileSlug(""), null);
  assert.equal(normalizeArenaProfileSlug("https://example.com/example-user"), null);
  assert.equal(normalizeArenaProfileSlug("bad slug"), null);
});

test("getConfiguredArenaProfile prefers runtime profile config", () => {
  assert.deepEqual(
    getConfiguredArenaProfile({
      ARENA_PROFILE_SLUG: "runtime-user",
      NEXT_PUBLIC_ARENA_PROFILE_SLUG: "legacy-user",
    }),
    { username: "runtime-user", url: profileUrl("runtime-user") },
  );
});
