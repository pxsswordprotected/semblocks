import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api";
import {
  ImageQueryError,
  QUERY_IMAGE_MAX_DATA_URL_CHARS,
  captionImageForQuery,
} from "@/lib/vision-query";
import {
  REC_K,
  REC_LIMIT,
  clampInt,
  runChannelRec,
} from "@/lib/recommend-core";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Live recommendation embeds (and, for images, captions) via OpenAI, so it
  // is owner-only. Public visitors use stored demo recommendations instead.
  const unauthorized = await requireAdminApi();
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { text, image_data_url, k, limit } = body as {
    text?: unknown;
    image_data_url?: unknown;
    k?: unknown;
    limit?: unknown;
  };

  // Strict discrimination: rejects { text: "", image_data_url: "..." } and
  // friends that would otherwise sneak through a typeof-only check.
  const hasText = typeof text === "string" && text.trim().length > 0;
  const hasImage =
    typeof image_data_url === "string" && image_data_url.length > 0;
  if (hasText && hasImage) {
    return NextResponse.json(
      { error: "provide text or image_data_url, not both" },
      { status: 400 },
    );
  }
  if (!hasText && !hasImage) {
    return NextResponse.json(
      { error: "provide text or image_data_url" },
      { status: 400 },
    );
  }

  // Cheap pre-check; captionImageForQuery enforces the same bound, but
  // bailing here avoids a wasted vision call on oversized payloads.
  if (
    hasImage &&
    (image_data_url as string).length > QUERY_IMAGE_MAX_DATA_URL_CHARS
  ) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }

  const knnK = clampInt(k, REC_K, 1, 200);
  const channelLimit = clampInt(limit, REC_LIMIT, 1, 50);

  try {
    if (hasImage) {
      const { caption, ocr_text, ocr_summary } = await captionImageForQuery(
        image_data_url as string,
      );
      const result = await runChannelRec(caption, knnK, channelLimit);
      return NextResponse.json({
        ...result,
        query: caption,
        caption_meta: { ocr_text, ocr_summary },
      });
    }
    const result = await runChannelRec(text as string, knnK, channelLimit);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ImageQueryError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
