// Shared low-level vision pass used by both the corpus OCR job
// (`lib/ocr.ts`) and the query-time image captioner (`lib/vision-query.ts`).
//
// Holds the prompt, the model name, the OpenAI client, and the
// response parser — nothing else. No DB access, no business logic.

import OpenAI from "openai";

export const VISION_MODEL = "gpt-4o-mini";

const DEFAULT_VISION_IMAGE_DETAIL = "high";
const DEFAULT_VISION_MAX_COMPLETION_TOKENS = 500;

// Use the most directed prompt for the corpus: prioritises verbatim
// transcription, structures the metadata into parseable lines.
export const VISION_PROMPT = `Output plain text only. Do not use markdown formatting, code fences, or asterisks.

First, transcribe any visible text verbatim. Preserve important line breaks. Do not summarize or paraphrase the visible text.

If this is a screenshot of social media, include the platform, author name, and handle if visible.

Then add these two lines exactly, with no markdown:
Description: one short sentence describing the image type and what it depicts.
Concepts: 3 to 10 short keywords or concepts, comma-separated. Preserve exact named concepts, titles, authors, handles, religious terms, philosophical terms, technical terms, and unusual phrases.

If there is no readable text, output only the Description and Concepts lines.`;

// Generous per-call cap because SDK retries can wait several seconds
// between attempts when 429s land.
const TIMEOUT_MS = 120_000;

function visionImageDetail(): "low" | "high" | "auto" {
  const raw = process.env.OCR_IMAGE_DETAIL;
  return raw === "low" || raw === "high" || raw === "auto"
    ? raw
    : DEFAULT_VISION_IMAGE_DETAIL;
}

function visionMaxCompletionTokens(): number {
  const raw = process.env.OCR_MAX_COMPLETION_TOKENS;
  if (!raw) return DEFAULT_VISION_MAX_COMPLETION_TOKENS;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_VISION_MAX_COMPLETION_TOKENS;
}

let _client: OpenAI | null = null;
export function visionClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  // maxRetries handles transient 429s with backoff. Default is 2; we run
  // batched vision calls and routinely hit the per-minute TPM cap.
  _client = new OpenAI({ apiKey, maxRetries: 5 });
  return _client;
}

// Run the vision pass on a single image URL (http(s) or data:). Returns
// the raw model output, untrimmed beyond a single .trim() — callers feed
// it to parseVisionResponse.
export async function visionCaption(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await visionClient().chat.completions.create(
      {
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: VISION_PROMPT },
              { type: "image_url", image_url: { url, detail: visionImageDetail() } },
            ],
          },
        ],
        max_completion_tokens: visionMaxCompletionTokens(),
      },
      { signal: controller.signal },
    );
    return res.choices[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// Split the model response into the transcription (verbatim text) and
// the summary (Description + Concepts). If the model didn't follow the
// format, dump the whole response into ocr_text and leave ocr_summary
// NULL — downstream still has something to embed.
export function parseVisionResponse(raw: string): {
  ocr_text: string;
  ocr_summary: string | null;
} {
  const text = raw.trim();
  if (!text) return { ocr_text: "", ocr_summary: null };

  // Match `Description:` even if the model wrapped it in **bold**, *italic*
  // or __underscore__ markers despite the prompt asking for plain text.
  const descMatch = text.match(
    /^[*_]{0,2}\s*Description\s*[*_]{0,2}\s*:\s*[*_]{0,2}\s*/im,
  );
  if (!descMatch || descMatch.index === undefined) {
    return { ocr_text: cleanTranscription(text), ocr_summary: null };
  }
  const transcription = cleanTranscription(text.slice(0, descMatch.index));
  const summary = text.slice(descMatch.index).trim();
  return { ocr_text: transcription, ocr_summary: summary };
}

// Strip the "Transcription:" header and any leading/trailing code fences
// the model may add despite being asked not to.
function cleanTranscription(s: string): string {
  return s
    .trim()
    .replace(/^[*_]{0,2}\s*Transcription\s*[*_]{0,2}\s*:\s*[*_]{0,2}\s*/im, "")
    .replace(/^```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}
