// External content extraction via Jina Reader.
//
// Pending = block_type IN ('Link', 'Attachment') with a non-empty http(s)
// source_url, not on the host/extension blocklist, and no
// block_link_content row with a non-NULL fetched_at. Each url is fetched
// through r.jina.ai which returns markdown of the rendered article body
// (or extracted PDF text for Attachment blocks pointing at PDFs).
//
// Error semantics (divergent from OCR):
//   - 4xx other than 429 (404, 403, 410, ...): persistent. Row stored
//     with fetched_at = NOW so we don't retry every run. Cleared on
//     ?rebuild=1.
//   - 429 / 5xx / network / timeout: retryable. Row stored with NULL
//     fetched_at, so the next run picks it up.
//   - Filtered (host blocklist, extension, post-fetch quality): stored
//     with fetched_at = NOW (these never become valid without rebuild).
//
// After writing a successful row, the block's search_text is recomputed
// to fold the new article body in alongside title/description/OCR, and
// the existing vec_blocks row is dropped so the next embed pass picks
// up the fattened search_text.

import { getDb } from "@/lib/db";
import { buildSearchText } from "@/lib/search-text";
import { cleanLinkMarkdown } from "@/lib/link-clean";
import {
  clearChunksForBlock,
  EXTERNAL_CONTENT_CHUNK_TYPE,
  rebuildChunksForBlock,
} from "@/lib/chunks";

// Full markdown stored for debugging / future re-ranking.
const EXTERNAL_CONTENT_STORE_MAX_CHARS = 40_000;
// Slice fed into search_text (and therefore the embedding). 16K ≈ 4K
// tokens; the lede of an article carries the thesis.
export const EXTERNAL_CONTENT_EMBED_SLICE_CHARS = 16_000;

const EXTRACTOR = "jina-reader";

const HOST_BLOCKLIST = new Set([
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
  "vimeo.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "facebook.com",
  "linkedin.com",
  "amazon.com",
  "amazon.co.uk",
  "amazon.com.au",
  "amazon.de",
  "amazon.fr",
  "tertulia.com",
]);

const EXT_BLOCKLIST = [
  ".zip",
  ".dmg",
  ".exe",
  ".mp4",
  ".mp3",
  ".mov",
  ".m4a",
  ".wav",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
];

const WALL_PATTERNS = [
  /403\s+forbidden/i,
  /404\s+not\s+found/i,
  /access\s+denied/i,
  /page\s+not\s+found/i,
  /sign\s+in\s+to\s+read/i,
  /subscribe\s+to\s+continue/i,
  /members?\s+only/i,
  /apologies,?\s*but\s+something\s+went\s+wrong/i,
];

function isCloudflareChallenge(head: string): boolean {
  return /just a moment/i.test(head) && /cloudflare/i.test(head);
}

export type ExternalContentResult = {
  processed: number;
  errors: number;
  skipped: number;
  cleared: number;
};

type PendingRow = {
  id: number;
  source_url: string;
};

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function classifyUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "filtered: invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "filtered: non-http" };
  }
  const host = normalizeHost(url.hostname);
  if (HOST_BLOCKLIST.has(host)) {
    return { ok: false, reason: `filtered: host:${host}` };
  }
  const path = url.pathname.toLowerCase();
  for (const ext of EXT_BLOCKLIST) {
    if (path.endsWith(ext)) {
      return { ok: false, reason: `filtered: ext:${ext}` };
    }
  }
  return { ok: true, url };
}

function rejectPostFetch(body: string): string | null {
  if (!body || body.trim().length < 80) return "filtered: too-short";
  const head = body.slice(0, 200);
  if (isCloudflareChallenge(head)) return "filtered: cloudflare-challenge";
  for (const re of WALL_PATTERNS) {
    if (re.test(head)) return `filtered: wall-${re.source.replace(/\\s\+/g, "-").slice(0, 32)}`;
  }
  return null;
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FetchResult =
  | { kind: "ok"; body: string }
  | { kind: "persistent"; error: string }
  | { kind: "retryable"; error: string };

async function fetchOne(url: string, timeoutMs: number): Promise<FetchResult> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    return { kind: "retryable", error: "JINA_API_KEY missing" };
  }
  const target = `https://r.jina.ai/${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Return-Format": "markdown",
        "X-Timeout": String(Math.max(5, Math.floor(timeoutMs / 1000))),
        Accept: "text/plain, */*",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const status = res.status;
      const snippet = (await res.text()).slice(0, 300);
      const msg = `http ${status}: ${snippet}`;
      if (status === 429 || status >= 500) {
        return { kind: "retryable", error: msg };
      }
      return { kind: "persistent", error: msg };
    }
    const body = await res.text();
    return { kind: "ok", body };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "retryable", error: `fetch: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  timeoutMs: number,
): Promise<FetchResult> {
  let attempt = 0;
  let lastRetryable: FetchResult | null = null;
  while (attempt < 3) {
    const r = await fetchOne(url, timeoutMs);
    if (r.kind === "ok" || r.kind === "persistent") return r;
    lastRetryable = r;
    attempt += 1;
    if (attempt < 3) await sleep(1000 * 2 ** attempt); // 2s, 4s
  }
  return lastRetryable ?? { kind: "retryable", error: "exhausted retries" };
}

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

export async function extractPendingExternalContent(
  opts: { limit?: number; rebuild?: boolean } = {},
): Promise<ExternalContentResult> {
  const limit = opts.limit ?? 100;
  const concurrency = envInt("LINK_READER_CONCURRENCY", 1);
  const delayMs = envInt("LINK_READER_DELAY_MS", 7000);
  const timeoutMs = envInt("LINK_READER_TIMEOUT_MS", 60_000);

  const db = getDb();

  if (!process.env.JINA_API_KEY) {
    throw new Error("JINA_API_KEY is not set");
  }

  let cleared = 0;
  if (opts.rebuild) {
    cleared = (db
      .prepare(
        `SELECT COUNT(*) AS c FROM block_link_content c
           JOIN blocks b ON b.id = c.block_id
          WHERE b.block_type IN ('Link', 'Attachment')`,
      )
      .get() as { c: number }).c;
    db.exec(
      `DELETE FROM chunk_embedding_meta
         WHERE chunk_id IN (
           SELECT bc.id
             FROM block_chunks bc
             JOIN blocks b ON b.id = bc.block_id
            WHERE b.block_type IN ('Link', 'Attachment')
         );
       DELETE FROM vec_block_chunks
         WHERE chunk_id IN (
           SELECT bc.id
             FROM block_chunks bc
             JOIN blocks b ON b.id = bc.block_id
            WHERE b.block_type IN ('Link', 'Attachment')
         );
       DELETE FROM block_chunks WHERE block_id IN (
         SELECT id FROM blocks WHERE block_type IN ('Link', 'Attachment')
       );
       DELETE FROM block_link_content WHERE block_id IN (
         SELECT id FROM blocks WHERE block_type IN ('Link', 'Attachment')
       )`,
    );
  }

  const pending = db
    .prepare(
      `SELECT b.id, b.source_url
         FROM blocks b
         LEFT JOIN block_link_content c ON c.block_id = b.id
        WHERE b.block_type IN ('Link', 'Attachment')
          AND b.source_url IS NOT NULL
          AND length(trim(b.source_url)) > 0
          AND (c.block_id IS NULL OR c.fetched_at IS NULL)
        ORDER BY b.id
        LIMIT ?`,
    )
    .all(limit) as PendingRow[];

  if (pending.length === 0) {
    return { processed: 0, errors: 0, skipped: 0, cleared };
  }

  // Success path: store full content + recompute search_text.
  const upsertOk = db.prepare(`
    INSERT INTO block_link_content (
      block_id, url, content_text, content_chars, extractor, fetched_at, error
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), NULL)
    ON CONFLICT(block_id) DO UPDATE SET
      url           = excluded.url,
      content_text  = excluded.content_text,
      content_chars = excluded.content_chars,
      extractor     = excluded.extractor,
      fetched_at    = excluded.fetched_at,
      error         = NULL
  `);

  // Persistent error (4xx non-429, filtered): mark fetched_at so we don't retry.
  const upsertPersistent = db.prepare(`
    INSERT INTO block_link_content (
      block_id, url, content_text, content_chars, extractor, fetched_at, error
    ) VALUES (?, ?, NULL, NULL, ?, datetime('now'), ?)
    ON CONFLICT(block_id) DO UPDATE SET
      url           = excluded.url,
      content_text  = NULL,
      content_chars = NULL,
      extractor     = excluded.extractor,
      fetched_at    = excluded.fetched_at,
      error         = excluded.error
  `);

  // Retryable error (5xx, network, timeout, 429): NULL fetched_at so the
  // next run picks it back up.
  const upsertRetryable = db.prepare(`
    INSERT INTO block_link_content (
      block_id, url, content_text, content_chars, extractor, fetched_at, error
    ) VALUES (?, ?, NULL, NULL, ?, NULL, ?)
    ON CONFLICT(block_id) DO UPDATE SET
      url           = excluded.url,
      content_text  = NULL,
      content_chars = NULL,
      extractor     = excluded.extractor,
      fetched_at    = NULL,
      error         = excluded.error
  `);

  const selectBlock = db.prepare(`
    SELECT b.title, b.description, b.content_text, b.block_type,
           b.source_provider_name, o.ocr_text, o.ocr_summary,
           c.content_text AS external_content
      FROM blocks b
      LEFT JOIN block_ocr o ON o.block_id = b.id
      LEFT JOIN block_link_content c ON c.block_id = b.id
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
  const invalidateBlockVector = db.prepare(
    `DELETE FROM vec_blocks WHERE block_id = ?`,
  );
  const invalidateBlockMeta = db.prepare(
    `DELETE FROM block_embedding_meta WHERE block_id = ?`,
  );

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  // Pre-filter: bin the pending rows by what we'll actually do.
  type Work = { row: PendingRow; cls: ReturnType<typeof classifyUrl> };
  const work: Work[] = pending.map((row) => ({
    row,
    cls: classifyUrl(row.source_url),
  }));

  // Write filtered rows synchronously (no network). These count as skipped.
  const filtered = work.filter((w) => !w.cls.ok);
  if (filtered.length > 0) {
    db.transaction(() => {
      for (const w of filtered) {
        if (w.cls.ok) continue;
        upsertPersistent.run(w.row.id, w.row.source_url, EXTRACTOR, w.cls.reason);
        clearChunksForBlock(db, w.row.id, EXTERNAL_CONTENT_CHUNK_TYPE);
      }
    })();
    skipped += filtered.length;
  }

  const fetchable = work.filter((w): w is { row: PendingRow; cls: { ok: true; url: URL } } => w.cls.ok);
  if (fetchable.length === 0) {
    return { processed: 0, errors: 0, skipped, cleared };
  }

  // Per-worker pacing: each worker waits at least delayMs between request starts.
  const lastStartByWorker = new Map<number, number>();
  let workerCounter = 0;

  await runPool(fetchable, concurrency, async (item) => {
    // Stable per-worker id derived from cursor; cheap & good enough.
    const workerId = workerCounter++ % concurrency;
    const last = lastStartByWorker.get(workerId) ?? 0;
    const wait = delayMs - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    lastStartByWorker.set(workerId, Date.now());

    const url = item.cls.url.toString();
    const r = await fetchWithRetry(url, timeoutMs);

    if (r.kind === "ok") {
      const cleaned = cleanLinkMarkdown(r.body, { host: item.cls.url.hostname });
      if (!cleaned || cleaned.length < 200) {
        try {
          db.transaction(() => {
            upsertPersistent.run(
              item.row.id,
              url,
              EXTRACTOR,
              "filtered: post-clean-too-short",
            );
            clearChunksForBlock(db, item.row.id, EXTERNAL_CONTENT_CHUNK_TYPE);
          })();
        } catch {}
        skipped += 1;
        return;
      }
      const wall = rejectPostFetch(cleaned);
      if (wall) {
        try {
          db.transaction(() => {
            upsertPersistent.run(item.row.id, url, EXTRACTOR, wall);
            clearChunksForBlock(db, item.row.id, EXTERNAL_CONTENT_CHUNK_TYPE);
          })();
        } catch {}
        skipped += 1;
        return;
      }
      const stored = cleaned.slice(0, EXTERNAL_CONTENT_STORE_MAX_CHARS).trim();
      try {
        db.transaction(() => {
          upsertOk.run(item.row.id, url, stored, stored.length, EXTRACTOR);
          rebuildChunksForBlock(
            db,
            item.row.id,
            EXTERNAL_CONTENT_CHUNK_TYPE,
            stored,
          );
          const b = selectBlock.get(item.row.id) as
            | {
                title: string | null;
                description: string | null;
                content_text: string | null;
                block_type: string | null;
                source_provider_name: string | null;
                ocr_text: string | null;
                ocr_summary: string | null;
                external_content: string | null;
              }
            | undefined;
          if (b) {
            const channelTitles = (
              selectChannels.all(item.row.id) as Array<{ title: string | null }>
            )
              .map((c) => c.title)
              .filter((t): t is string => Boolean(t && t.trim()));
            const sliced = b.external_content
              ? b.external_content.slice(0, EXTERNAL_CONTENT_EMBED_SLICE_CHARS)
              : null;
            const newSearchText = buildSearchText({
              title: b.title,
              description: b.description,
              content_text: b.content_text,
              ocr_text: b.ocr_text,
              ocr_summary: b.ocr_summary,
              external_content: sliced,
              block_type: b.block_type,
              source_provider_name: b.source_provider_name,
              channel_titles: channelTitles,
            });
            updateSearchText.run(newSearchText, item.row.id);
            // Keep vector and freshness metadata consistent after changing
            // search_text; the hash check would also catch this on the next
            // embed pass.
            invalidateBlockVector.run(item.row.id);
            invalidateBlockMeta.run(item.row.id);
          }
        })();
        processed += 1;
      } catch (err) {
        console.error(
          `external-content: block ${item.row.id} write failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        errors += 1;
      }
      return;
    }

    if (r.kind === "persistent") {
      try {
        db.transaction(() => {
          upsertPersistent.run(item.row.id, url, EXTRACTOR, r.error.slice(0, 500));
          clearChunksForBlock(db, item.row.id, EXTERNAL_CONTENT_CHUNK_TYPE);
        })();
      } catch {}
      errors += 1;
      return;
    }

    // retryable
    try {
      db.transaction(() => {
        upsertRetryable.run(item.row.id, url, EXTRACTOR, r.error.slice(0, 500));
        clearChunksForBlock(db, item.row.id, EXTERNAL_CONTENT_CHUNK_TYPE);
      })();
    } catch {}
    console.error(`external-content: block ${item.row.id} (${url}) retryable: ${r.error}`);
    errors += 1;
  });

  return { processed, errors, skipped, cleared };
}
