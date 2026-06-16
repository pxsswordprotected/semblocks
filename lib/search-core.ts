// Core search pipeline extracted from app/api/search/route.ts so
// scripts (e.g. evals) can call runSearch without booting Next.
import { getDb } from "./db.ts";
import { embed } from "./embeddings.ts";
import { EMPTY_SEARCH_FILTER_OPTIONS, resolveDateAddedRange } from "./search-filters.ts";
import type { SearchFilterOptions } from "./search-filters.ts";

export type Hit = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  source_url: string | null;
  arena_url: string | null;
  snippet: string | null;
  channel_title: string | null;
  channel_url: string | null;
  distance: number; // adjusted ranking score
  vec_distance: number; // raw cosine distance from sqlite-vec
  match_type: "block" | "chunk";
  chunk_index?: number;
  source_start_char?: number;
  source_end_char?: number;
};

// Row shapes from SQL. distance below is the raw vec distance; we
// transform into Hit (with adjusted distance + vec_distance) in TS.
type BlockHitRow = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  source_url: string | null;
  arena_url: string | null;
  snippet: string | null;
  channel_title: string | null;
  channel_url: string | null;
  distance: number;
  search_text: string | null;
};
type ChunkHitRow = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  source_url: string | null;
  arena_url: string | null;
  snippet: string | null;
  channel_title: string | null;
  channel_url: string | null;
  distance: number;
  chunk_index: number;
  source_start_char: number;
  source_end_char: number;
  match_text: string | null;
};

function envNum(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

const CHUNK_FLAT_PENALTY = envNum("SEARCH_CHUNK_FLAT_PENALTY", 0.01);
const CHUNK_BROAD_PENALTY = envNum("SEARCH_CHUNK_BROAD_PENALTY", 0.03);
const PHRASE_BOOST = envNum("SEARCH_PHRASE_BOOST", 0.04);
const RARE_TERM_BOOST = envNum("SEARCH_RARE_TERM_BOOST", 0.02);
const TITLE_MATCH_BOOST = envNum("SEARCH_TITLE_MATCH_BOOST", 0.03);
const BROAD_TOKEN_THRESHOLD = envNum("SEARCH_BROAD_TOKEN_THRESHOLD", 3);

// Stopwords filtered from boost calculations. Title and rare-term boosts
// require every (content) token to appear in the candidate; without this
// filter, `to/of/and` would either bias the rare-term path (none qualify
// because of the len>=6 cap, harmless) or — for the title path — demand
// that titles contain trivia like "to" or "of", causing legit matches to
// silently lose the boost. Phrase boost uses the same normalized query
// (with stopwords kept) so verbatim phrase matching still works.
const STOPWORDS = new Set([
  "a", "the", "of", "and", "to", "in", "for", "is",
]);

// Normalize strings for lexical matching: lowercase, fold smart quotes
// and dashes into ASCII, strip markdown emphasis/link punctuation, then
// collapse whitespace. Phrase and token matches both operate on this
// normalized form, so "interaction design" in a query matches
// "**Interaction Design.**" or "[Interaction\nDesign](url)" in body.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[*_`~\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(normalizedQ: string): string[] {
  return normalizedQ
    .split(" ")
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function lexicalAdjustment(
  text: string | null,
  title: string | null,
  qNorm: string,
  tokens: string[],
): number {
  let adj = 0;
  if (text) {
    const haystack = normalize(text);
    if (tokens.length >= 2 && haystack.includes(qNorm)) adj -= PHRASE_BOOST;
    const rare = tokens.filter((t) => t.length >= 6);
    if (rare.length > 0 && rare.every((t) => haystack.includes(t))) {
      adj -= RARE_TERM_BOOST;
    }
  }
  // Title boost: every content token appears in the title. Selective by
  // construction; safely no-ops on generic single-word queries because we
  // still require all tokens to land on the same title.
  if (title && tokens.length >= 1) {
    const t = normalize(title);
    if (tokens.every((tok) => t.includes(tok))) adj -= TITLE_MATCH_BOOST;
  }
  return adj;
}

function chooseBetter(existing: Hit | undefined, candidate: Hit): Hit {
  if (!existing) return candidate;
  return candidate.distance < existing.distance ? candidate : existing;
}

export const MAX_SEARCH_LIMIT = 500;

export function parseLimit(raw: string | null): number {
  return Math.min(Math.max(Number(raw ?? 10), 1), MAX_SEARCH_LIMIT);
}

// Channel-filter parser used by both GET (CSV in querystring) and POST
// (array in body). Returns null when no filter applies (the default
// behavior matches the pre-filter API). Empty-after-parse also collapses
// to null so a malformed `?channels=` doesn't accidentally hide all
// results.
export function parseChannelFilter(raw: unknown): number[] | null {
  if (raw == null) return null;
  let items: unknown[] = [];
  if (typeof raw === "string") items = raw.split(",");
  else if (Array.isArray(raw)) items = raw;
  else return null;
  const out: number[] = [];
  for (const t of items) {
    const n = typeof t === "number" ? t : Number(String(t).trim());
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return out.length === 0 ? null : Array.from(new Set(out));
}

// Path selector. Path A pushes a rowid `IN (...)` predicate alongside
// `MATCH` into sqlite-vec's KNN scan. Path B (fallback) runs an
// unfiltered KNN with inflated k and applies the channel mask in JS.
//
// 2026-05-23: curl verification (see plan §3) confirmed pushdown returns
// the correct subset on sqlite-vec 0.1.6 for this schema (block_id /
// chunk_id declared INTEGER PRIMARY KEY = vec0 rowid). Override with
// SEARCH_CHANNEL_FILTER_FALLBACK=1 if a future sqlite-vec release breaks
// the pushdown — the JS fallback is exercised by the same tests.
const USE_FALLBACK = process.env.SEARCH_CHANNEL_FILTER_FALLBACK === "1";

// Embed → KNN → lexical re-rank pipeline shared by GET (text query) and
// POST (image query, after captioning).
export async function runSearch(
  qText: string,
  limit: number,
  channels: number[] | null,
  filters: SearchFilterOptions = EMPTY_SEARCH_FILTER_OPTIONS,
): Promise<Hit[]> {
  const qNorm = normalize(qText);
  const tokens = tokenize(qNorm);
  const isBroad = tokens.length <= BROAD_TOKEN_THRESHOLD;

  const vec = await embed(qText);
  const vector = Buffer.from(vec.buffer);
  const db = getDb();
  const baseBlockK = Math.max(limit * 4, 20);
  const baseChunkK = Math.max(limit * 8, 50);
  const blockTypes = filters.blockTypes ?? [];
  const typeFiltered = blockTypes.length > 0;
  const typeInList = blockTypes.map(() => "?").join(",");
  const dateRange = resolveDateAddedRange(filters.dateAdded);
  const dateFiltered = dateRange !== null;
  const blockFiltered = typeFiltered || dateFiltered;
  const blockTypeClause = typeFiltered ? `AND b.block_type IN (${typeInList})` : "";
  const blockDateClause = dateRange
    ? `AND date(b.created_at) >= date(?)${dateRange.to ? "\n               AND date(b.created_at) <= date(?)" : ""}`
    : "";
  const blockFilterParams = dateRange
    ? dateRange.to
      ? [...blockTypes, dateRange.from, dateRange.to]
      : [...blockTypes, dateRange.from]
    : [...blockTypes];

  // When the channel filter is active we either push it down into the
  // KNN scan (Path A) or over-fetch and post-filter (Path B). See the
  // USE_FALLBACK comment above for the verification record.
  const channelFiltered = channels !== null && channels.length > 0;
  let blockRows: BlockHitRow[];
  let chunkRows: ChunkHitRow[];

  if (!channelFiltered) {
    blockRows = db
      .prepare(
        `WITH ${blockFiltered ? `allowed AS (
            SELECT b.id AS block_id
              FROM blocks b
             WHERE 1 = 1
               ${blockTypeClause}
               ${blockDateClause}
          ),` : ""} knn AS MATERIALIZED (
            SELECT block_id, distance
              FROM vec_blocks
             WHERE embedding MATCH ?
               AND k = ?
               ${blockFiltered ? "AND block_id IN (SELECT block_id FROM allowed)" : ""}
          )
          SELECT
            knn.block_id     AS block_id,
            knn.distance     AS distance,
            b.arena_block_id AS arena_block_id,
            b.title          AS title,
            b.block_type     AS block_type,
            b.source_url     AS source_url,
            b.arena_url      AS arena_url,
            substr(b.search_text, 1, 240) AS snippet,
            b.search_text    AS search_text,
            c.title          AS channel_title,
            c.url            AS channel_url
           FROM knn
           JOIN blocks b ON b.id = knn.block_id
           LEFT JOIN block_channels bc ON bc.block_id = knn.block_id
           LEFT JOIN channels c        ON c.id = bc.channel_id
          GROUP BY knn.block_id
          ORDER BY knn.distance`,
      )
      .all(...blockFilterParams, vector, baseBlockK) as BlockHitRow[];

    chunkRows = db
      .prepare(
        `WITH ${blockFiltered ? `allowed_chunks AS (
            SELECT ch.id AS chunk_id
              FROM block_chunks ch
              JOIN blocks b ON b.id = ch.block_id
             WHERE 1 = 1
               ${blockTypeClause}
               ${blockDateClause}
          ),` : ""} knn AS MATERIALIZED (
            SELECT chunk_id, distance
              FROM vec_block_chunks
             WHERE embedding MATCH ?
               AND k = ?
               ${blockFiltered ? "AND chunk_id IN (SELECT chunk_id FROM allowed_chunks)" : ""}
          )
          SELECT
            ch.block_id             AS block_id,
            knn.distance            AS distance,
            b.arena_block_id        AS arena_block_id,
            b.title                 AS title,
            b.block_type            AS block_type,
            b.source_url            AS source_url,
            b.arena_url             AS arena_url,
            substr(ch.text, 1, 240) AS snippet,
            ch.text                 AS match_text,
            c.title                 AS channel_title,
            c.url                   AS channel_url,
            ch.chunk_index          AS chunk_index,
            ch.source_start_char    AS source_start_char,
            ch.source_end_char      AS source_end_char
           FROM knn
           JOIN block_chunks ch ON ch.id = knn.chunk_id
           JOIN blocks b        ON b.id = ch.block_id
           LEFT JOIN block_channels bc ON bc.block_id = ch.block_id
           LEFT JOIN channels c        ON c.id = bc.channel_id
          GROUP BY knn.chunk_id
          ORDER BY knn.distance`,
      )
      .all(...blockFilterParams, vector, baseChunkK) as ChunkHitRow[];
  } else if (!USE_FALLBACK) {
    // Path A — pushdown. Allowed-block CTE is materialized once and
    // referenced from the vec0 WHERE clause; sqlite-vec 0.1.6 honors
    // `block_id IN (...)` against vec0 rowid as a pre-knn filter.
    const inList = channels.map(() => "?").join(",");
    blockRows = db
      .prepare(
        `WITH allowed AS (
            SELECT DISTINCT bc.block_id
              FROM block_channels bc
              ${blockFiltered ? "JOIN blocks b ON b.id = bc.block_id" : ""}
             WHERE bc.channel_id IN (${inList})
               ${blockTypeClause}
               ${blockDateClause}
          ),
          knn AS MATERIALIZED (
            SELECT block_id, distance
              FROM vec_blocks
             WHERE embedding MATCH ?
               AND k = ?
               AND block_id IN (SELECT block_id FROM allowed)
          )
          SELECT
            knn.block_id     AS block_id,
            knn.distance     AS distance,
            b.arena_block_id AS arena_block_id,
            b.title          AS title,
            b.block_type     AS block_type,
            b.source_url     AS source_url,
            b.arena_url      AS arena_url,
            substr(b.search_text, 1, 240) AS snippet,
            b.search_text    AS search_text,
            c.title          AS channel_title,
            c.url            AS channel_url
           FROM knn
           JOIN blocks b ON b.id = knn.block_id
           LEFT JOIN block_channels bc ON bc.block_id = knn.block_id
           LEFT JOIN channels c        ON c.id = bc.channel_id
          GROUP BY knn.block_id
          ORDER BY knn.distance`,
      )
      .all(...channels, ...blockFilterParams, vector, baseBlockK) as BlockHitRow[];

    chunkRows = db
      .prepare(
        `WITH allowed_blocks AS (
            SELECT DISTINCT bc.block_id
              FROM block_channels bc
              ${blockFiltered ? "JOIN blocks b ON b.id = bc.block_id" : ""}
             WHERE bc.channel_id IN (${inList})
               ${blockTypeClause}
               ${blockDateClause}
          ),
          allowed_chunks AS (
            SELECT ch.id AS chunk_id
              FROM block_chunks ch
             WHERE ch.block_id IN (SELECT block_id FROM allowed_blocks)
          ),
          knn AS MATERIALIZED (
            SELECT chunk_id, distance
              FROM vec_block_chunks
             WHERE embedding MATCH ?
               AND k = ?
               AND chunk_id IN (SELECT chunk_id FROM allowed_chunks)
          )
          SELECT
            ch.block_id             AS block_id,
            knn.distance            AS distance,
            b.arena_block_id        AS arena_block_id,
            b.title                 AS title,
            b.block_type            AS block_type,
            b.source_url            AS source_url,
            b.arena_url             AS arena_url,
            substr(ch.text, 1, 240) AS snippet,
            ch.text                 AS match_text,
            c.title                 AS channel_title,
            c.url                   AS channel_url,
            ch.chunk_index          AS chunk_index,
            ch.source_start_char    AS source_start_char,
            ch.source_end_char      AS source_end_char
           FROM knn
           JOIN block_chunks ch ON ch.id = knn.chunk_id
           JOIN blocks b        ON b.id = ch.block_id
           LEFT JOIN block_channels bc ON bc.block_id = ch.block_id
           LEFT JOIN channels c        ON c.id = bc.channel_id
          GROUP BY knn.chunk_id
          ORDER BY knn.distance`,
      )
      .all(...channels, ...blockFilterParams, vector, baseChunkK) as ChunkHitRow[];
  } else {
    // Path B — fallback. Run the unfiltered KNN with inflated k, gather
    // allowed block ids in JS, and drop everything else. Correct for any
    // sqlite-vec planner since the filter never leaves user space.
    const totalChannels = (
      db.prepare(`SELECT COUNT(*) AS c FROM channels`).get() as { c: number }
    ).c;
    const ratio =
      totalChannels > 0 && channels.length > 0
        ? Math.max(1, Math.ceil(totalChannels / channels.length))
        : 1;
    const fbBlockK = baseBlockK * ratio;
    const fbChunkK = baseChunkK * ratio;
    const inList = channels.map(() => "?").join(",");
    const allowedIds = new Set<number>(
      (db
        .prepare(
          `SELECT DISTINCT bc.block_id
             FROM block_channels bc
             ${blockFiltered ? "JOIN blocks b ON b.id = bc.block_id" : ""}
            WHERE bc.channel_id IN (${inList})
              ${blockTypeClause}
              ${blockDateClause}`,
        )
        .all(...channels, ...blockFilterParams) as Array<{ block_id: number }>).map(
        (r) => r.block_id,
      ),
    );
    blockRows = (db
      .prepare(
        `WITH knn AS MATERIALIZED (
            SELECT block_id, distance
              FROM vec_blocks
             WHERE embedding MATCH ?
               AND k = ?
          )
          SELECT
            knn.block_id     AS block_id,
            knn.distance     AS distance,
            b.arena_block_id AS arena_block_id,
            b.title          AS title,
            b.block_type     AS block_type,
            b.source_url     AS source_url,
            b.arena_url      AS arena_url,
            substr(b.search_text, 1, 240) AS snippet,
            b.search_text    AS search_text,
            c.title          AS channel_title,
            c.url            AS channel_url
           FROM knn
           JOIN blocks b ON b.id = knn.block_id
           LEFT JOIN block_channels bc ON bc.block_id = knn.block_id
           LEFT JOIN channels c        ON c.id = bc.channel_id
          GROUP BY knn.block_id
          ORDER BY knn.distance`,
      )
      .all(vector, fbBlockK) as BlockHitRow[]).filter((r) =>
      allowedIds.has(r.block_id),
    );
    chunkRows = (db
      .prepare(
        `WITH knn AS MATERIALIZED (
            SELECT chunk_id, distance
              FROM vec_block_chunks
             WHERE embedding MATCH ?
               AND k = ?
          )
          SELECT
            ch.block_id             AS block_id,
            knn.distance            AS distance,
            b.arena_block_id        AS arena_block_id,
            b.title                 AS title,
            b.block_type            AS block_type,
            b.source_url            AS source_url,
            b.arena_url             AS arena_url,
            substr(ch.text, 1, 240) AS snippet,
            ch.text                 AS match_text,
            c.title                 AS channel_title,
            c.url                   AS channel_url,
            ch.chunk_index          AS chunk_index,
            ch.source_start_char    AS source_start_char,
            ch.source_end_char      AS source_end_char
           FROM knn
           JOIN block_chunks ch ON ch.id = knn.chunk_id
           JOIN blocks b        ON b.id = ch.block_id
           LEFT JOIN block_channels bc ON bc.block_id = ch.block_id
           LEFT JOIN channels c        ON c.id = bc.channel_id
          GROUP BY knn.chunk_id
          ORDER BY knn.distance`,
      )
      .all(vector, fbChunkK) as ChunkHitRow[]).filter((r) =>
      allowedIds.has(r.block_id),
    );
  }

  const byBlock = new Map<number, Hit>();
  for (const row of blockRows) {
    const lex = lexicalAdjustment(row.search_text, row.title, qNorm, tokens);
    const adjusted = row.distance + lex;
    const hit: Hit = {
      block_id: row.block_id,
      arena_block_id: row.arena_block_id,
      title: row.title,
      block_type: row.block_type,
      source_url: row.source_url,
      arena_url: row.arena_url,
      snippet: row.snippet,
      channel_title: row.channel_title,
      channel_url: row.channel_url,
      distance: adjusted,
      vec_distance: row.distance,
      match_type: "block",
    };
    byBlock.set(row.block_id, chooseBetter(byBlock.get(row.block_id), hit));
  }
  for (const row of chunkRows) {
    const lex = lexicalAdjustment(row.match_text, row.title, qNorm, tokens);
    let adjusted = row.distance + CHUNK_FLAT_PENALTY + lex;
    if (isBroad) adjusted += CHUNK_BROAD_PENALTY;
    const hit: Hit = {
      block_id: row.block_id,
      arena_block_id: row.arena_block_id,
      title: row.title,
      block_type: row.block_type,
      source_url: row.source_url,
      arena_url: row.arena_url,
      snippet: row.snippet,
      channel_title: row.channel_title,
      channel_url: row.channel_url,
      distance: adjusted,
      vec_distance: row.distance,
      match_type: "chunk",
      chunk_index: row.chunk_index,
      source_start_char: row.source_start_char,
      source_end_char: row.source_end_char,
    };
    byBlock.set(row.block_id, chooseBetter(byBlock.get(row.block_id), hit));
  }

  return Array.from(byBlock.values())
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}
