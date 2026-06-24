import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import {
  buildJsonExportForBlockIds,
  getExportBlockIdsForChannels,
  jsonExportResponse,
  parseExportChannelIds,
} from "@/lib/json-export";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const channelIds = parseExportChannelIds(url.searchParams.get("ids"));
  if (!channelIds) {
    return NextResponse.json(
      { error: "Missing or invalid ?ids= channel list" },
      { status: 400 },
    );
  }

  try {
    const blockIds = getExportBlockIdsForChannels(channelIds);
    const payload = buildJsonExportForBlockIds({
      blockIds,
      scope: { type: "channels", channel_ids: channelIds },
    });

    return jsonExportResponse(payload, "semblocks-export-channels");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
