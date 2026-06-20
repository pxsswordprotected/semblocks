import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import {
  SearchSessionInputError,
  createOrReuseSearchSession,
} from "@/lib/search-sessions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("q" in body)) {
    return NextResponse.json({ error: "Search query is required" }, { status: 400 });
  }

  const q = (body as { q?: unknown }).q;
  if (typeof q !== "string") {
    return NextResponse.json({ error: "Search query is required" }, { status: 400 });
  }

  try {
    const session = createOrReuseSearchSession(q);
    return NextResponse.json({
      sid: session.id,
      reused: session.reused,
      expires_at: session.expires_at,
    });
  } catch (err) {
    if (err instanceof SearchSessionInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
