import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { ArenaError } from "@/lib/arena";
import { runFullSync } from "@/lib/full-sync";
import { logIngestError } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const userParam = url.searchParams.get("user");
  if (!userParam) {
    return NextResponse.json({ error: "Missing ?user=" }, { status: 400 });
  }

  try {
    const result = await runFullSync({ user: userParam });
    return NextResponse.json(result);
  } catch (err) {
    const slug = (() => {
      try {
        return new URL(req.url).searchParams.get("user") ?? "";
      } catch {
        return "";
      }
    })();
    logIngestError(slug, err);
    if (err instanceof ArenaError) {
      return NextResponse.json(
        { error: err.message, status: err.status },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
