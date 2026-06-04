import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  expiredAdminCookieOptions,
} from "@/lib/admin-auth";
import { sameOriginPathUrl } from "@/lib/request-url";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  const res = wantsJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(sameOriginPathUrl(req, "/dev"), { status: 303 });
  res.cookies.set(ADMIN_COOKIE_NAME, "", expiredAdminCookieOptions());
  return res;
}
