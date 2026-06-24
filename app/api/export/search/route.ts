import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import {
  parseChannelFilter,
  parseLimit,
  runSearch,
} from "@/lib/search-core";
import {
  SearchFilterValidationError,
  parseSearchFiltersFromApiQuery,
} from "@/lib/search-filters";
import type { SearchFilterOptions } from "@/lib/search-filters";
import {
  SearchSessionNotFoundError,
  resolveSearchQuery,
} from "@/lib/search-sessions";
import {
  buildMarkdownExportForBlockIds,
  markdownExportResponse,
} from "@/lib/markdown-export";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const sid = url.searchParams.get("sid");
  const limit = parseLimit(url.searchParams.get("k"));
  const channels = parseChannelFilter(url.searchParams.get("channels"));
  let filters: SearchFilterOptions;
  try {
    filters = parseSearchFiltersFromApiQuery(url.searchParams);
  } catch (err) {
    if (err instanceof SearchFilterValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  let query: string;
  try {
    query = resolveSearchQuery({ q, sid });
  } catch (err) {
    if (err instanceof SearchSessionNotFoundError) {
      return NextResponse.json(
        { error: "Search session not found" },
        { status: 404 },
      );
    }
    throw err;
  }

  if (!query) {
    return NextResponse.json({ error: "Missing ?q= or ?sid=" }, { status: 400 });
  }

  try {
    const hits = await runSearch(query, limit, channels, filters);
    const document = buildMarkdownExportForBlockIds({
      blockIds: hits.map((hit) => hit.block_id),
      scope: { type: "search", query, limit, filters, channel_ids: channels },
    });
    return markdownExportResponse(document, "semblocks-export-search");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
