import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getJob, listJobEvents } from "@/lib/jobs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";

export async function GET(_req: Request, context: RouteContext) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job, events: listJobEvents(id) });
}
