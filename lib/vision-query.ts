// Query-time image captioner. Same vision pass we run over indexed
// `Image` blocks, exposed as a single async helper for the search API.
//
// Server-only. NEVER import from a client component — pulls in the
// OpenAI SDK via `lib/vision.ts`.

import { parseVisionResponse, visionCaption } from "./vision.ts";
import {
  QUERY_IMAGE_MAX_BYTES,
  QUERY_IMAGE_MAX_DATA_URL_CHARS,
} from "./query-image-limits.ts";

// Re-exported for caller convenience; canonical home is
// `lib/query-image-limits.ts` (which is client-safe).
export { QUERY_IMAGE_MAX_BYTES, QUERY_IMAGE_MAX_DATA_URL_CHARS };

export type ImageQueryCaption = {
  // The concatenated text we hand to the embedder. Non-empty on success.
  caption: string;
  // Verbatim transcription (may be empty if the image has no text).
  ocr_text: string;
  // "Description: …\nConcepts: …" block, or null if the model didn't
  // produce a recognizable summary section.
  ocr_summary: string | null;
};

export class ImageQueryError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ImageQueryError";
    this.status = status;
  }
}

const DATA_URL_PREFIX = "data:image/";

export async function captionImageForQuery(
  dataUrl: string,
): Promise<ImageQueryCaption> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(DATA_URL_PREFIX)) {
    throw new ImageQueryError(
      "image_data_url must be a data:image/* URL",
      400,
    );
  }
  if (dataUrl.length > QUERY_IMAGE_MAX_DATA_URL_CHARS) {
    throw new ImageQueryError("image too large", 413);
  }

  const raw = await visionCaption(dataUrl);
  const { ocr_text, ocr_summary } = parseVisionResponse(raw);
  const caption = [ocr_text, ocr_summary]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join("\n\n")
    .trim();

  if (!caption) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `vision-query: empty caption (raw=${JSON.stringify(raw).slice(0, 200)})`,
      );
    }
    throw new ImageQueryError("could not caption image", 400);
  }

  return { caption, ocr_text, ocr_summary };
}
