// Channel recommendation pipeline extracted from
// app/api/recommend-channel/route.ts so the route, demo generator, and any
// scripts can share one implementation. Embed → KNN → channel aggregation.
import { getDb } from "./db.ts";
import { embed } from "./embeddings.ts";

// Defaults — tuned by hand against searches-v7.md distances.
export const REC_K = 30; // candidate blocks pulled from vec_blocks
export const REC_MAX_DIST = 1.3; // clamp threshold for vote weight
export const REC_LIMIT = 5; // channels returned
export const REC_TOP_BLOCKS = 5; // per-channel evidence size
export const REC_MAX_CHARS = 8000; // mirrors lib/embed-blocks.ts MAX_CHARS

type KnnRow = {
  block_id: number;
  distance: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  arena_url: string | null;
  channel_id: number | null;
  channel_title: string | null;
  channel_url: string | null;
};

type ChannelSizeRow = { channel_id: number; size: number };

export type TopBlock = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  arena_url: string | null;
  vec_distance: number;
};

type ChannelAgg = {
  channel_id: number;
  channel_title: string | null;
  channel_url: string | null;
  raw_score: number;
  contributors: TopBlock[];
};

export type RelatedBlock = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  arena_url: string | null;
  channel_title: string | null;
  channel_url: string | null;
  vec_distance: number;
};

export type ChannelRecResult = {
  input_chars: number;
  channels: Array<{
    channel_id: number;
    channel_title: string | null;
    channel_url: string | null;
    raw_score: number;
    score: number;
    channel_size: number;
    block_count: number;
    top_blocks: TopBlock[];
  }>;
  related_blocks: RelatedBlock[];
};

export async function runChannelRec(
  qText: string,
  knnK: number,
  channelLimit: number,
): Promise<ChannelRecResult> {
  // Silently truncate oversized input — same convention as embed-blocks.
  const trimmed = qText.slice(0, REC_MAX_CHARS);

  const vec = await embed(trimmed);
  const vector = Buffer.from(vec.buffer);
  const db = getDb();

  // KNN over vec_blocks. LEFT JOIN block_channels so a block with no
  // channel is still surfaced in related_blocks. Blocks living in
  // multiple channels return one row per (block, channel) — intentional;
  // each membership casts a separate vote downstream.
  const rows = db
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
          b.arena_url      AS arena_url,
          c.id             AS channel_id,
          c.title          AS channel_title,
          c.url            AS channel_url
         FROM knn
         JOIN blocks b ON b.id = knn.block_id
         LEFT JOIN block_channels bc ON bc.block_id = knn.block_id
         LEFT JOIN channels c        ON c.id = bc.channel_id
        ORDER BY knn.distance`,
    )
    .all(vector, knnK) as KnnRow[];

  const agg = new Map<number, ChannelAgg>();
  const relatedByBlock = new Map<number, RelatedBlock>();

  for (const row of rows) {
    if (!relatedByBlock.has(row.block_id)) {
      relatedByBlock.set(row.block_id, {
        block_id: row.block_id,
        arena_block_id: row.arena_block_id,
        title: row.title,
        block_type: row.block_type,
        arena_url: row.arena_url,
        channel_title: row.channel_title,
        channel_url: row.channel_url,
        vec_distance: row.distance,
      });
    }

    if (row.channel_id == null) continue;
    const w = Math.max(0, REC_MAX_DIST - row.distance);
    if (w <= 0) continue;

    let bucket = agg.get(row.channel_id);
    if (!bucket) {
      bucket = {
        channel_id: row.channel_id,
        channel_title: row.channel_title,
        channel_url: row.channel_url,
        raw_score: 0,
        contributors: [],
      };
      agg.set(row.channel_id, bucket);
    }
    bucket.raw_score += w;
    bucket.contributors.push({
      block_id: row.block_id,
      arena_block_id: row.arena_block_id,
      title: row.title,
      block_type: row.block_type,
      arena_url: row.arena_url,
      vec_distance: row.distance,
    });
  }

  const channelIds = Array.from(agg.keys());
  const sizes = new Map<number, number>();
  if (channelIds.length > 0) {
    const placeholders = channelIds.map(() => "?").join(",");
    const sizeRows = db
      .prepare(
        `SELECT channel_id, COUNT(*) AS size
           FROM block_channels
          WHERE channel_id IN (${placeholders})
          GROUP BY channel_id`,
      )
      .all(...channelIds) as ChannelSizeRow[];
    for (const r of sizeRows) sizes.set(r.channel_id, r.size);
  }

  const channels = Array.from(agg.values())
    .map((c) => {
      const channel_size = sizes.get(c.channel_id) ?? 0;
      const score = c.raw_score / Math.log2(channel_size + 2);
      const top_blocks = c.contributors.slice(0, REC_TOP_BLOCKS);
      return {
        channel_id: c.channel_id,
        channel_title: c.channel_title,
        channel_url: c.channel_url,
        raw_score: c.raw_score,
        score,
        channel_size,
        block_count: c.contributors.length,
        top_blocks,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, channelLimit);

  return {
    input_chars: trimmed.length,
    channels,
    related_blocks: Array.from(relatedByBlock.values()),
  };
}

export function clampInt(
  raw: unknown,
  def: number,
  lo: number,
  hi: number,
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), lo), hi);
}
