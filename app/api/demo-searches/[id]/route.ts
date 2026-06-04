import { NextResponse } from "next/server";
import { getDemoSearch } from "@/lib/demo-searches";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";

// Public, zero-cost: serves a stored demo result snapshot. No OpenAI call.
export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const demo = getDemoSearch(id);
  if (!demo) {
    return NextResponse.json({ error: "Demo not found" }, { status: 404 });
  }
  return NextResponse.json({ demo });
}
