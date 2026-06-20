const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type LoginRateLimitResult = {
  limited: boolean;
  retryAfterSeconds: number;
};

export function adminLoginRateLimitKey(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  const candidate = forwardedFor || realIp || "unknown";
  return candidate.slice(0, 128);
}

export function checkAdminLoginRateLimit(
  key: string,
  now = Date.now(),
): LoginRateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (bucket) buckets.delete(key);
    return { limited: false, retryAfterSeconds: 0 };
  }

  return {
    limited: bucket.count >= MAX_FAILED_LOGINS,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function recordFailedAdminLogin(
  key: string,
  now = Date.now(),
): LoginRateLimitResult {
  const current = buckets.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + LOGIN_WINDOW_MS };

  bucket.count += 1;
  buckets.set(key, bucket);
  return checkAdminLoginRateLimit(key, now);
}

export function clearFailedAdminLogins(key: string): void {
  buckets.delete(key);
}

export function resetAdminLoginRateLimitForTest(): void {
  buckets.clear();
}
