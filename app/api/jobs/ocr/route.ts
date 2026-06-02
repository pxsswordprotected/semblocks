import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import { abandonStaleActiveJobs, createJob } from "@/lib/jobs";
import { startJob } from "@/lib/job-runner";

export const runtime = "nodejs";

const STALE_OCR_JOB_MS = 2 * 60 * 1000;


export async function POST(req: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : 500;
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(500, Math.floor(parsedLimit)))
    : 500;

  abandonStaleActiveJobs({
    dedupeKey: "ocr",
    staleAfterMs: STALE_OCR_JOB_MS,
  });

  const { job } = createJob({
    jobType: "ocr",
    dedupeKey: "ocr",
    progressTotal: limit,
  });
  startJob(job.id);
  return NextResponse.json({ job_id: job.id });
}
