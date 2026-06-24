import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import {
  buildMarkdownExportForBlockIds,
  getExportBlockIdsForChannels,
  markdownExportResponse,
  parseExportChannelIds,
} from "@/lib/markdown-export";

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
    const document = buildMarkdownExportForBlockIds({
      blockIds,
      scope: { type: "channels", channel_ids: channelIds },
    });

    return markdownExportResponse(document, "semblocks-export-channels");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
