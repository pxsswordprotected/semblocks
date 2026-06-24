import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import {
  buildMarkdownExportForBlockIds,
  getAllExportBlockIds,
  markdownExportResponse,
} from "@/lib/markdown-export";

export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  try {
    const blockIds = getAllExportBlockIds();
    const document = buildMarkdownExportForBlockIds({
      blockIds,
      scope: { type: "all" },
    });

    return markdownExportResponse(document, "semblocks-export-all");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
