import { NextResponse } from "next/server";
import { listDemoSearches, type DemoSearchKind } from "@/lib/demo-searches";

export const runtime = "nodejs";

// Public, zero-cost: returns stored demo metadata only (no OpenAI calls).
export async function GET(req: Request) {
  const kindParam = new URL(req.url).searchParams.get("kind");
  const kind: DemoSearchKind | undefined =
    kindParam === "search" || kindParam === "rec" ? kindParam : undefined;
  return NextResponse.json({ demos: listDemoSearches(kind) });
}
