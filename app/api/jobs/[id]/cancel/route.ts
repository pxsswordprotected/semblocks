import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { getJob, requestJobCancel } from "@/lib/jobs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";

export async function POST(_req: Request, context: RouteContext) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  const { id } = await context.params;
  if (!getJob(id)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const job = requestJobCancel(id);
  return NextResponse.json({ job });
}
