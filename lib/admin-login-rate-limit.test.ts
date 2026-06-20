import assert from "node:assert/strict";
import test from "node:test";
import {
  adminLoginRateLimitKey,
  checkAdminLoginRateLimit,
  clearFailedAdminLogins,
  recordFailedAdminLogin,
  resetAdminLoginRateLimitForTest,
} from "./admin-login-rate-limit.ts";

test("admin login rate limiter blocks repeated failed attempts per key", () => {
  resetAdminLoginRateLimitForTest();
  const key = "203.0.113.10";
  for (let i = 0; i < 9; i += 1) {
    assert.equal(recordFailedAdminLogin(key, 1_000).limited, false);
  }
  assert.equal(recordFailedAdminLogin(key, 1_000).limited, true);
  assert.equal(checkAdminLoginRateLimit(key, 1_000).limited, true);
});

test("admin login rate limiter clears after successful login", () => {
  resetAdminLoginRateLimitForTest();
  const key = "203.0.113.11";
  assert.equal(recordFailedAdminLogin(key, 1_000).limited, false);
  clearFailedAdminLogins(key);
  assert.equal(checkAdminLoginRateLimit(key, 1_000).limited, false);
});

test("admin login rate limiter derives key from proxy headers", () => {
  const req = new Request("https://example.com/api/admin/login", {
    headers: { "x-forwarded-for": "203.0.113.12, 10.0.0.1" },
  });
  assert.equal(adminLoginRateLimitKey(req), "203.0.113.12");
});
