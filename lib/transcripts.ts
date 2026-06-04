// YouTube transcript extraction via yt-dlp.
//
// Pending = blocks whose source_url matches a YouTube host (Embed dominates
// but Are.na occasionally parks a YouTube URL on a Text block — gate on URL,
// not block_type) and which lack a settled block_transcripts row.
//
// Error semantics (mirror lib/external-content.ts):
//   - persistent (no-subs-available, age/private/removed, empty post-parse):
//     stored with fetched_at = NOW + error set. Cleared only on ?rebuild=1.
//   - retryable (network, timeout, yt-dlp HTTP-5xx-looking stderr): stored
//     with fetched_at = NULL so the next run picks it up.
//
// On success the block's search_text is recomputed to fold the transcript
// in, the existing vec_blocks row is dropped (force re-embed), and transcript
// chunks are rebuilt for vec_block_chunks.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getDb } from "./db.ts";
import {
  clearChunksForBlock,
  rebuildChunksForBlock,
  TRANSCRIPT_CHUNK_TYPE,
} from "./chunks.ts";
import { buildSearchText } from "./search-text.ts";
import { parseVtt } from "./vtt.ts";

// Full transcript stored for debugging / future re-ranking. ~30K for a
// 90-minute lecture; 120K headroom covers multi-hour podcast auto-subs.
const TRANSCRIPT_STORE_MAX_CHARS = 120_000;
// Slice fed into search_text (and therefore the block embedding).
export const TRANSCRIPT_EMBED_SLICE_CHARS = 16_000;

const EXTRACTOR_MANUAL = "youtube-subs";
const EXTRACTOR_AUTO = "youtube-auto-subs";

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "music.youtube.com",
]);

const PERSISTENT_STDERR_PATTERNS: RegExp[] = [
  /private video/i,
  /members[- ]only/i,
  /age[- ]restricted|confirm your age|sign in to confirm/i,
  /removed by/i,
  /video unavailable/i,
  /is not available/i,
  /this live event/i,
  /no video formats found/i,
  /this video has been removed/i,
];

export type TranscriptResult = {
  processed: number;
  errors: number;
  skipped: number;
  cleared: number;
};

type PendingRow = { id: number; source_url: string };

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isYouTubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return YT_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}


// ---------- yt-dlp invocation ----------

type FetchResult =
  | { kind: "ok"; text: string; source: string; language: string }
  | { kind: "persistent"; error: string }
  | { kind: "retryable"; error: string };

class YtDlpMissingError extends Error {}

async function spawnYtDlp(
  url: string,
  outDir: string,
  timeoutMs: number,
): Promise<{ code: number; stderr: string }> {
  const bin = process.env.YT_DLP_PATH || "yt-dlp";
  const args = [
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    "en.*",
    "--sub-format",
    "vtt",
    "--no-warnings",
    "--no-progress",
    "--no-playlist",
    "--output",
    path.join(outDir, "%(id)s.%(ext)s"),
    url,
  ];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      reject(err);
      return;
    }

    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve({ code: -1, stderr: stderr + "\n[timeout]" });
    }, timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new YtDlpMissingError(
            "yt-dlp not found — install via 'brew install yt-dlp' or set YT_DLP_PATH",
          ),
        );
        return;
      }
      reject(err);
    });

    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    // Drain stdout so the pipe doesn't backpressure.
    child.stdout.on("data", () => {});

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

function classifyStderr(stderr: string): "persistent" | "retryable" {
  for (const re of PERSISTENT_STDERR_PATTERNS) {
    if (re.test(stderr)) return "persistent";
  }
  return "retryable";
}

async function pickVttFile(
  outDir: string,
): Promise<{ file: string; auto: boolean; language: string } | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(outDir);
  } catch {
    return null;
  }
  const vtts = entries.filter((f) => /\.vtt$/i.test(f));
  if (vtts.length === 0) return null;

  // Prefer non-auto (manual) over auto, English variants first.
  const score = (name: string): number => {
    let s = 0;
    const lower = name.toLowerCase();
    if (!lower.includes(".auto.") && !lower.includes("-auto.")) s += 100;
    if (/\.en\.vtt$/i.test(lower)) s += 20;
    else if (/\.en[-.]/i.test(lower)) s += 10;
    return s;
  };

  vtts.sort((a, b) => score(b) - score(a));
  const pick = vtts[0];
  const auto = /\.auto\.|-auto\./i.test(pick);
  // Best-effort language: capture `\.([a-z]{2}(?:-[a-zA-Z]+)?)(?:\.auto)?\.vtt$`.
  const m = pick.match(/\.([a-z]{2,}(?:-[A-Za-z]+)?)(?:[.-]auto)?\.vtt$/i);
  const language = m ? m[1] : "en";
  return { file: path.join(outDir, pick), auto, language };
}

async function fetchOne(
  url: string,
  timeoutMs: number,
): Promise<FetchResult> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "semblocks-yt-"));
  try {
    const result = await spawnYtDlp(url, tmpRoot, timeoutMs);
    if (result.code !== 0) {
      const kind = classifyStderr(result.stderr);
      const trimmed = result.stderr.trim().slice(-500) || `exit ${result.code}`;
      return { kind, error: trimmed };
    }
    const pick = await pickVttFile(tmpRoot);
    if (!pick) {
      return { kind: "persistent", error: "no-subs-available" };
    }
    const vtt = await fs.readFile(pick.file, "utf8");
    const text = parseVtt(vtt);
    if (!text) {
      return { kind: "persistent", error: "empty-transcript" };
    }
    return {
      kind: "ok",
      text,
      source: pick.auto ? EXTRACTOR_AUTO : EXTRACTOR_MANUAL,
      language: pick.language,
    };
  } finally {
    fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- extractor entry point ----------

export async function extractPendingTranscripts(
  opts: { limit?: number; rebuild?: boolean } = {},
): Promise<TranscriptResult> {
  const limit = opts.limit ?? 100;
  const concurrency = envInt("YT_DLP_CONCURRENCY", 1);
  const delayMs = envInt("YT_DLP_DELAY_MS", 3000);
  const timeoutMs = envInt("YT_DLP_TIMEOUT_MS", 60_000);

  const db = getDb();

  let cleared = 0;
  if (opts.rebuild) {
    cleared = (
      db.prepare(`SELECT COUNT(*) AS c FROM block_transcripts`).get() as {
        c: number;
      }
    ).c;
    db.exec(
      `DELETE FROM chunk_embedding_meta
         WHERE chunk_id IN (
           SELECT id FROM block_chunks WHERE chunk_type = 'transcript'
         );
       DELETE FROM vec_block_chunks
         WHERE chunk_id IN (
           SELECT id FROM block_chunks WHERE chunk_type = 'transcript'
         );
       DELETE FROM block_chunks WHERE chunk_type = 'transcript';
       DELETE FROM block_transcripts;`,
    );
  }

  const pending = db
    .prepare(
      `SELECT b.id, b.source_url
         FROM blocks b
         LEFT JOIN block_transcripts t ON t.block_id = b.id
        WHERE b.source_url IS NOT NULL
          AND length(trim(b.source_url)) > 0
          AND (
            b.source_url LIKE 'https://www.youtube.com/%'
            OR b.source_url LIKE 'https://youtube.com/%'
            OR b.source_url LIKE 'https://m.youtube.com/%'
            OR b.source_url LIKE 'https://music.youtube.com/%'
            OR b.source_url LIKE 'https://youtu.be/%'
            OR b.source_url LIKE 'http://www.youtube.com/%'
            OR b.source_url LIKE 'http://youtube.com/%'
            OR b.source_url LIKE 'http://m.youtube.com/%'
            OR b.source_url LIKE 'http://youtu.be/%'
          )
          AND (t.block_id IS NULL OR t.fetched_at IS NULL)
        ORDER BY b.id
        LIMIT ?`,
    )
    .all(limit) as PendingRow[];

  if (pending.length === 0) {
    return { processed: 0, errors: 0, skipped: 0, cleared };
  }

  const upsertOk = db.prepare(`
    INSERT INTO block_transcripts (
      block_id, transcript_text, source, language, fetched_at, error
    ) VALUES (?, ?, ?, ?, datetime('now'), NULL)
    ON CONFLICT(block_id) DO UPDATE SET
      transcript_text = excluded.transcript_text,
      source          = excluded.source,
      language        = excluded.language,
      fetched_at      = excluded.fetched_at,
      error           = NULL
  `);
  const upsertPersistent = db.prepare(`
    INSERT INTO block_transcripts (
      block_id, transcript_text, source, language, fetched_at, error
    ) VALUES (?, NULL, ?, NULL, datetime('now'), ?)
    ON CONFLICT(block_id) DO UPDATE SET
      transcript_text = NULL,
      source          = excluded.source,
      language        = NULL,
      fetched_at      = excluded.fetched_at,
      error           = excluded.error
  `);
  const upsertRetryable = db.prepare(`
    INSERT INTO block_transcripts (
      block_id, transcript_text, source, language, fetched_at, error
    ) VALUES (?, NULL, ?, NULL, NULL, ?)
    ON CONFLICT(block_id) DO UPDATE SET
      transcript_text = NULL,
      source          = excluded.source,
      language        = NULL,
      fetched_at      = NULL,
      error           = excluded.error
  `);

  const selectBlock = db.prepare(`
    SELECT b.title, b.description, b.content_text, b.block_type,
           b.source_provider_name,
           o.ocr_text, o.ocr_summary,
           c.content_text AS external_content,
           t.transcript_text
      FROM blocks b
      LEFT JOIN block_ocr o ON o.block_id = b.id
      LEFT JOIN block_link_content c ON c.block_id = b.id
      LEFT JOIN block_transcripts t ON t.block_id = b.id
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

  // Pre-filter rows whose URL doesn't actually parse as YouTube (shouldn't
  // happen given the SQL LIKE gate, but be defensive).
  const work = pending.filter((row) => {
    if (isYouTubeUrl(row.source_url)) return true;
    try {
      db.transaction(() => {
        upsertPersistent.run(row.id, EXTRACTOR_MANUAL, "filtered: bad-url");
        clearChunksForBlock(db, row.id, TRANSCRIPT_CHUNK_TYPE);
      })();
    } catch {}
    skipped += 1;
    return false;
  });

  if (work.length === 0) {
    return { processed: 0, errors: 0, skipped, cleared };
  }

  console.log(
    `[sync:transcripts] start fetchable=${work.length} skipped_prefilter=${skipped} limit=${limit}`,
  );

  const lastStartByWorker = new Map<number, number>();
  let workerCounter = 0;
  let completed = 0;
  const recordProgress = () => {
    completed += 1;
    if (completed === work.length || completed % 10 === 0) {
      console.log(
        `[sync:transcripts] progress ${completed}/${work.length} processed=${processed} errors=${errors} skipped=${skipped}`,
      );
    }
  };

  const runOne = async (item: PendingRow) => {
    const workerId = workerCounter++ % concurrency;
    const last = lastStartByWorker.get(workerId) ?? 0;
    const wait = delayMs - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    lastStartByWorker.set(workerId, Date.now());

    let r: FetchResult;
    try {
      r = await fetchOne(item.source_url, timeoutMs);
    } catch (err) {
      if (err instanceof YtDlpMissingError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      try {
        db.transaction(() => {
          upsertRetryable.run(item.id, EXTRACTOR_MANUAL, msg.slice(0, 500));
        })();
      } catch {}
      console.error(`transcripts: block ${item.id} spawn failed: ${msg}`);
      errors += 1;
      recordProgress();
      return;
    }

    if (r.kind === "ok") {
      const stored = r.text.slice(0, TRANSCRIPT_STORE_MAX_CHARS).trim();
      try {
        db.transaction(() => {
          upsertOk.run(item.id, stored, r.source, r.language);
          rebuildChunksForBlock(db, item.id, TRANSCRIPT_CHUNK_TYPE, stored);
          const b = selectBlock.get(item.id) as
            | {
                title: string | null;
                description: string | null;
                content_text: string | null;
                block_type: string | null;
                source_provider_name: string | null;
                ocr_text: string | null;
                ocr_summary: string | null;
                external_content: string | null;
                transcript_text: string | null;
              }
            | undefined;
          if (b) {
            const channelTitles = (
              selectChannels.all(item.id) as Array<{ title: string | null }>
            )
              .map((c) => c.title)
              .filter((t): t is string => Boolean(t && t.trim()));
            const sliced = b.transcript_text
              ? b.transcript_text.slice(0, TRANSCRIPT_EMBED_SLICE_CHARS)
              : null;
            const newSearchText = buildSearchText({
              title: b.title,
              description: b.description,
              content_text: b.content_text,
              ocr_text: b.ocr_text,
              ocr_summary: b.ocr_summary,
              external_content: b.external_content,
              transcript_text: sliced,
              block_type: b.block_type,
              source_provider_name: b.source_provider_name,
              channel_titles: channelTitles,
            });
            updateSearchText.run(newSearchText, item.id);
            invalidateBlockVector.run(item.id);
            invalidateBlockMeta.run(item.id);
          }
        })();
        processed += 1;
      } catch (err) {
        console.error(
          `transcripts: block ${item.id} write failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        errors += 1;
      }
      recordProgress();
      return;
    }

    if (r.kind === "persistent") {
      try {
        db.transaction(() => {
          upsertPersistent.run(item.id, EXTRACTOR_MANUAL, r.error.slice(0, 500));
          clearChunksForBlock(db, item.id, TRANSCRIPT_CHUNK_TYPE);
        })();
      } catch {}
      // "no-subs-available" / "empty-transcript" / age-locked etc. aren't
      // really errors from the user's POV; treat as skipped, mirroring the
      // external-content "filtered" semantics.
      if (
        r.error === "no-subs-available" ||
        r.error === "empty-transcript" ||
        r.error.startsWith("filtered:")
      ) {
        skipped += 1;
      } else {
        errors += 1;
      }
      recordProgress();
      return;
    }

    try {
      db.transaction(() => {
        upsertRetryable.run(item.id, EXTRACTOR_MANUAL, r.error.slice(0, 500));
        clearChunksForBlock(db, item.id, TRANSCRIPT_CHUNK_TYPE);
      })();
    } catch {}
    console.error(
      `transcripts: block ${item.id} (${item.source_url}) retryable: ${r.error}`,
    );
    errors += 1;
    recordProgress();
  };

  // Simple bounded pool.
  const queue = work.slice();
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          await runOne(next);
        }
      })(),
    );
  }
  await Promise.all(workers);

  return { processed, errors, skipped, cleared };
}
