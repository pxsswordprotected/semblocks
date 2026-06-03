import { NextResponse } from "next/server";
import {
  parseChannelFilter,
  parseLimit,
  runSearch,
} from "@/lib/search-core";
import {
  ImageQueryError,
  QUERY_IMAGE_MAX_DATA_URL_CHARS,
  captionImageForQuery,
} from "@/lib/vision-query";
import {
  SearchSessionNotFoundError,
  resolveSearchQuery,
} from "@/lib/search-sessions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const sid = url.searchParams.get("sid");
  const limit = parseLimit(url.searchParams.get("k"));
  const channels = parseChannelFilter(url.searchParams.get("channels"));

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
    const hits = await runSearch(query, limit, channels);
    return NextResponse.json({ query, hits });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Image-input search. The client posts a base64 data URL; we caption it
// with the same vision pass used at index time and feed the caption
// through `runSearch`.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { image_data_url, k, channels: channelsRaw } = body as {
    image_data_url?: unknown;
    k?: unknown;
    channels?: unknown;
  };
  if (typeof image_data_url !== "string" || !image_data_url) {
    return NextResponse.json(
      { error: "image_data_url is required" },
      { status: 400 },
    );
  }
  // Surface oversize payloads as 413 before the vision call burns a token.
  if (image_data_url.length > QUERY_IMAGE_MAX_DATA_URL_CHARS) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }

  const limit = parseLimit(typeof k === "number" ? String(k) : null);
  const channels = parseChannelFilter(channelsRaw);

  try {
    const { caption, ocr_text, ocr_summary } =
      await captionImageForQuery(image_data_url);
    const hits = await runSearch(caption, limit, channels);
    return NextResponse.json({
      query: caption,
      caption_meta: { ocr_text, ocr_summary },
      hits,
    });
  } catch (err) {
    if (err instanceof ImageQueryError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
