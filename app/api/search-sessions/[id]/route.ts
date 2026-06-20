import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getSearchSession } from "@/lib/search-sessions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";

export async function GET(_req: Request, context: RouteContext) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const session = getSearchSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "Search session not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    sid: session.id,
    q: session.query_text,
    expires_at: session.expires_at,
  });
}
