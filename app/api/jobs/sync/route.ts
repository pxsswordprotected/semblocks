import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { parseUserSlug } from "@/lib/arena";
import { createJob } from "@/lib/jobs";
import { startJob } from "@/lib/job-runner";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const userParam = url.searchParams.get("user");
  if (!userParam) {
    return NextResponse.json({ error: "Missing ?user=" }, { status: 400 });
  }

  const username = parseUserSlug(userParam);
  const { job } = createJob({
    jobType: "sync_full",
    dedupeKey: `sync_full:${username}`,
    progressTotal: 6,
  });
  startJob(job.id);
  return NextResponse.json({ job_id: job.id });
}
