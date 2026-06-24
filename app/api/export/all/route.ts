import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import {
  buildJsonExportForBlockIds,
  getAllExportBlockIds,
  jsonExportResponse,
} from "@/lib/json-export";

export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  try {
    const blockIds = getAllExportBlockIds();
    const payload = buildJsonExportForBlockIds({
      blockIds,
      scope: { type: "all" },
    });

    return jsonExportResponse(payload, "semblocks-export-all");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
