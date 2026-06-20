import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  adminCookieOptions,
  createCurrentAdminSessionToken,
  getConfiguredAdminAuth,
} from "@/lib/admin-auth";
import { isAdminAuthConfigured, verifyAdminPassword } from "@/lib/admin-auth-core";
import {
  adminLoginRateLimitKey,
  checkAdminLoginRateLimit,
  clearFailedAdminLogins,
  recordFailedAdminLogin,
} from "@/lib/admin-login-rate-limit";
import { sameOriginPathUrl } from "@/lib/request-url";

export const runtime = "nodejs";

type LoginBody = { password?: unknown };

export async function POST(req: Request) {
  const wantsJson = wantsJsonResponse(req);
  const config = getConfiguredAdminAuth();
  if (!isAdminAuthConfigured(config)) {
    return authFailure(req, wantsJson, "config", 500, "Admin auth is not configured");
  }

  const rateLimitKey = adminLoginRateLimitKey(req);
  const rateLimit = checkAdminLoginRateLimit(rateLimitKey);
  if (rateLimit.limited) {
    return authFailure(
      req,
      wantsJson,
      "rate_limit",
      429,
      "Too many login attempts. Try again later.",
      rateLimit.retryAfterSeconds,
    );
  }

  const parsed = await readPassword(req);
  if (!parsed.ok) {
    return authFailure(req, wantsJson, "missing", 400, parsed.error);
  }

  if (!verifyAdminPassword(parsed.password, config.password)) {
    recordFailedAdminLogin(rateLimitKey);
    return authFailure(req, wantsJson, "invalid", 401, "Invalid password");
  }

  clearFailedAdminLogins(rateLimitKey);

  const token = createCurrentAdminSessionToken();
  const res = wantsJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(sameOriginPathUrl(req, "/dev"), { status: 303 });
  res.cookies.set(ADMIN_COOKIE_NAME, token, adminCookieOptions());
  return res;
}

async function readPassword(
  req: Request,
): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: LoginBody;
    try {
      body = (await req.json()) as LoginBody;
    } catch {
      return { ok: false, error: "Invalid JSON body" };
    }
    if (typeof body.password !== "string" || body.password.length === 0) {
      return { ok: false, error: "Password is required" };
    }
    return { ok: true, password: body.password };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, error: "Invalid form body" };
  }
  const password = form.get("password");
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "Password is required" };
  }
  return { ok: true, password };
}

function wantsJsonResponse(req: Request): boolean {
  const contentType = req.headers.get("content-type") ?? "";
  const accept = req.headers.get("accept") ?? "";
  return contentType.includes("application/json") || accept.includes("application/json");
}

function authFailure(
  req: Request,
  wantsJson: boolean,
  code: string,
  status: number,
  message: string,
  retryAfterSeconds?: number,
): NextResponse {
  if (wantsJson) {
    const res = NextResponse.json({ error: message }, { status });
    if (retryAfterSeconds !== undefined) {
      res.headers.set("Retry-After", String(retryAfterSeconds));
    }
    return res;
  }
  const url = sameOriginPathUrl(req, "/dev");
  url.searchParams.set("error", code);
  const res = NextResponse.redirect(url, { status: 303 });
  if (retryAfterSeconds !== undefined) {
    res.headers.set("Retry-After", String(retryAfterSeconds));
  }
  return res;
}
