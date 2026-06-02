// OCR + visual description pass for image blocks.
//
// Pending = block_type='Image' with an image URL and no successful
// block_ocr row yet. Each image gets one gpt-4o-mini vision call; result
// parsed into ocr_text (verbatim transcription) and ocr_summary
// (description + concepts). After writing, search_text for that block
// is recomputed from the current DB row + channels + the new OCR.
//
// Errors don't mark a block as permanently processed: the row goes in
// with ocr_error set and ocr_processed_at NULL, so the next run picks
// it up automatically.
//
// The low-level vision call (prompt, model, response parsing) lives in
// `lib/vision.ts` so the same machinery powers query-time image search.

import { getDb } from "./db.ts";
import { buildSearchText } from "./search-text.ts";
import {
  VISION_MODEL,
  parseVisionResponse,
  visionCaption,
} from "./vision.ts";

// OpenAI vision requests are paced by start time and allowed to overlap.
// This keeps throughput high when individual calls are slow while still
// bounding TPM pressure. Tune with OCR_CONCURRENCY and OCR_MIN_CALL_GAP_MS.
const DEFAULT_CONCURRENCY = 3;

export type OcrResult = {
  processed: number;
  errors: number;
  skipped: number;
  cleared: number;
};

export type OcrProgress = {
  total: number;
  completed: number;
  processed: number;
  errors: number;
  skipped: number;
};

export type OcrOptions = {
  limit?: number;
  rebuild?: boolean;
  onProgress?: (progress: OcrProgress) => void | Promise<void>;
  shouldCancel?: () => boolean | Promise<boolean>;
};


type PendingRow = {
  id: number;
  image_display_url: string | null;
  image_original_url: string | null;
};

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        await worker(items[i], i);
      }
    });
  await Promise.all(runners);
}

// Minimum gap between OpenAI vision calls. Keep calls serialized, but make
// the gap configurable because account TPM limits vary; 1s is conservative
// for the current gpt-4o-mini vision requests and 429s are retried below.
const DEFAULT_MIN_CALL_GAP_MS = 1000;
const MAX_RATE_LIMIT_RETRIES = 6;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function ocrConcurrency(): number {
  return envInt("OCR_CONCURRENCY", DEFAULT_CONCURRENCY);
}

function minCallGapMs(): number {
  const raw = process.env.OCR_MIN_CALL_GAP_MS;
  if (!raw) return DEFAULT_MIN_CALL_GAP_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_MIN_CALL_GAP_MS;
}

function createStartPacer(minGapMs: number): () => Promise<void> {
  let gate: Promise<void> = Promise.resolve();
  let nextStartAt = 0;

  return async () => {
    const previous = gate;
    let release: () => void = () => {};
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous.catch(() => undefined);
    try {
      const wait = Math.max(0, nextStartAt - Date.now());
      if (wait > 0) await sleep(wait);
      nextStartAt = Date.now() + minGapMs;
    } finally {
      release();
    }
  };
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDurationMs(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return Math.max(0, asNumber * 1000);

  let total = 0;
  let matched = false;
  for (const match of trimmed.matchAll(/([0-9]+(?:\.[0-9]+)?)(ms|s|m|h)/gi)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "ms") total += amount;
    else if (unit === "s") total += amount * 1000;
    else if (unit === "m") total += amount * 60_000;
    else if (unit === "h") total += amount * 3_600_000;
  }
  if (matched) return Math.max(0, total);

  const asDate = Date.parse(trimmed);
  return Number.isFinite(asDate) ? Math.max(0, asDate - Date.now()) : null;
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (typeof headers !== "object") return null;

  const record = headers as Record<string, unknown>;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== lowerName) continue;
    return typeof value === "string" ? value : null;
  }
  return null;
}

function retryDelayFromRateLimitError(err: unknown): number | null {
  const headers =
    err && typeof err === "object" ? (err as { headers?: unknown }).headers : null;

  for (const name of [
    "x-ratelimit-reset-tokens",
    "x-ratelimit-reset-requests",
    "retry-after",
  ]) {
    const value = headerValue(headers, name);
    if (!value) continue;
    const parsed = parseDurationMs(value);
    if (parsed !== null) return parsed;
  }

  const message = err instanceof Error ? err.message : String(err);
  const ms = message.match(/try again in\s+(\d+)ms/i);
  if (ms) return Number(ms[1]);

  const seconds = message.match(/try again in\s+([0-9.]+)s/i);
  if (seconds) return Number(seconds[1]) * 1000;

  return null;
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybeStatus = err as { status?: unknown; code?: unknown; message?: unknown };
  if (maybeStatus.status === 429 || maybeStatus.code === "rate_limit_exceeded") {
    return true;
  }
  return (
    typeof maybeStatus.message === "string" &&
    /rate limit|too many requests|429/i.test(maybeStatus.message)
  );
}

async function visionCaptionWithRateLimitRetry(url: string): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await visionCaption(url);
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= MAX_RATE_LIMIT_RETRIES) throw err;

      const parsedDelay = retryDelayFromRateLimitError(err);
      const fallbackDelay = 1_000 * 2 ** attempt;
      const jitter = 250 + Math.floor(Math.random() * 750);
      await sleep((parsedDelay ?? fallbackDelay) + jitter);
    }
  }
}

export async function ocrPendingImages(
  opts: OcrOptions = {},
): Promise<OcrResult> {
  const limit = opts.limit ?? 25;
  const db = getDb();

  let cleared = 0;
  if (opts.rebuild) {
    cleared = (db
      .prepare(
        `SELECT COUNT(*) AS c FROM block_ocr o
           JOIN blocks b ON b.id = o.block_id
          WHERE b.block_type = 'Image'`,
      )
      .get() as { c: number }).c;
    db.exec(
      `DELETE FROM block_ocr WHERE block_id IN (
         SELECT id FROM blocks WHERE block_type = 'Image'
       )`,
    );
  }

  const pending = db
    .prepare(
      `SELECT b.id, b.image_display_url, b.image_original_url
         FROM blocks b
         LEFT JOIN block_ocr o ON o.block_id = b.id
        WHERE b.block_type = 'Image'
          AND (o.block_id IS NULL OR o.ocr_processed_at IS NULL)
          AND COALESCE(b.image_display_url, b.image_original_url) IS NOT NULL
          AND length(trim(COALESCE(b.image_display_url, b.image_original_url))) > 0
        ORDER BY b.id
        LIMIT ?`,
    )
    .all(limit) as PendingRow[];

  if (pending.length === 0) {
    await opts.onProgress?.({
      total: 0,
      completed: 0,
      processed: 0,
      errors: 0,
      skipped: 0,
    });
    return { processed: 0, errors: 0, skipped: 0, cleared };
  }

  console.log(`[sync:ocr] start pending=${pending.length} limit=${limit}`);
  const upsertOcr = db.prepare(`
    INSERT INTO block_ocr (
      block_id, ocr_text, ocr_summary, ocr_model, ocr_processed_at, ocr_error
    ) VALUES (?, ?, ?, ?, datetime('now'), NULL)
    ON CONFLICT(block_id) DO UPDATE SET
      ocr_text         = excluded.ocr_text,
      ocr_summary      = excluded.ocr_summary,
      ocr_model        = excluded.ocr_model,
      ocr_processed_at = excluded.ocr_processed_at,
      ocr_error        = NULL
  `);
  const upsertOcrError = db.prepare(`
    INSERT INTO block_ocr (
      block_id, ocr_text, ocr_summary, ocr_model, ocr_processed_at, ocr_error
    ) VALUES (?, NULL, NULL, ?, NULL, ?)
    ON CONFLICT(block_id) DO UPDATE SET
      ocr_model        = excluded.ocr_model,
      ocr_processed_at = NULL,
      ocr_error        = excluded.ocr_error
  `);

  // Statements for recomputing search_text after a successful OCR.
  const selectBlock = db.prepare(`
    SELECT b.title, b.description, b.content_text, b.block_type,
           b.source_provider_name, o.ocr_text, o.ocr_summary
      FROM blocks b
      LEFT JOIN block_ocr o ON o.block_id = b.id
     WHERE b.id = ?
  `);
  const selectChannels = db.prepare(`
    SELECT c.title FROM block_channels bc
      JOIN channels c ON c.id = bc.channel_id
     WHERE bc.block_id = ?
  `);
  const updateSearchText = db.prepare(
    `UPDATE blocks SET search_text = ? WHERE id = ?`,
  );

  let processed = 0;
  let errors = 0;
  let skipped = 0;
  let completed = 0;

  const emitProgress = async () => {
    await opts.onProgress?.({
      total: pending.length,
      completed,
      processed,
      errors,
      skipped,
    });
  };
  let cancelled = false;

  const concurrency = ocrConcurrency();
  const minGapMs = minCallGapMs();
  const waitForStartSlot = createStartPacer(minGapMs);
  console.log(
    `[sync:ocr] config concurrency=${concurrency} min_start_gap_ms=${minGapMs}`,
  );
  await emitProgress();
  await runPool(pending, concurrency, async (row) => {
    if (cancelled || (await opts.shouldCancel?.())) {
      cancelled = true;
      return;
    }
    await waitForStartSlot();
    if (cancelled || (await opts.shouldCancel?.())) {
      cancelled = true;
      return;
    }
    const url =
      row.image_display_url && row.image_display_url.trim()
        ? row.image_display_url
        : row.image_original_url;
    if (!url) {
      skipped += 1;
      completed += 1;
      await emitProgress();
      return;
    }

    try {
      const raw = await visionCaptionWithRateLimitRetry(url);
      const parsed = parseVisionResponse(raw);
      // Single sync transaction per block: write OCR + recompute the
      // block's search_text in one shot.
      db.transaction(() => {
        upsertOcr.run(
          row.id,
          parsed.ocr_text || null,
          parsed.ocr_summary,
          VISION_MODEL,
        );
        const b = selectBlock.get(row.id) as
          | {
              title: string | null;
              description: string | null;
              content_text: string | null;
              block_type: string | null;
              source_provider_name: string | null;
              ocr_text: string | null;
              ocr_summary: string | null;
            }
          | undefined;
        if (b) {
          const channelTitles = (
            selectChannels.all(row.id) as Array<{ title: string | null }>
          )
            .map((c) => c.title)
            .filter((t): t is string => Boolean(t && t.trim()));
          const newSearchText = buildSearchText({
            title: b.title,
            description: b.description,
            content_text: b.content_text,
            ocr_text: b.ocr_text,
            ocr_summary: b.ocr_summary,
            block_type: b.block_type,
            source_provider_name: b.source_provider_name,
            channel_titles: channelTitles,
          });
          updateSearchText.run(newSearchText, row.id);
        }
      })();
      processed += 1;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      try {
        upsertOcrError.run(row.id, VISION_MODEL, message.slice(0, 500));
      } catch {
        // swallow secondary failure
      }
      console.error(`ocr: block ${row.id} (${url}) failed: ${message}`);
      errors += 1;
    } finally {
      // Pacing is by request start time, not completion time.
      completed += 1;
      if (completed === pending.length || completed % 10 === 0) {
        console.log(
          `[sync:ocr] progress ${completed}/${pending.length} processed=${processed} errors=${errors}`,
        );
      }
      await emitProgress();
    }
  });

  return { processed, errors, skipped, cleared };
}
