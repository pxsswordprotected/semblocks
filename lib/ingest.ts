// Persist an Are.na user's channels + all fetched channel contents into the
// local SQLite store. Idempotent: re-running for the
// same user updates rows in place, keyed on Are.na IDs / username.

import type Database from "better-sqlite3";
import {
  ArenaError,
  getAllUserChannels,
  getAllChannelBlocks,
  getUser,
  type ArenaBlock,
  type ArenaChannel,
  type ArenaUser,
} from "./arena.ts";
import { getDb } from "./db.ts";
import { buildSearchText } from "./search-text.ts";
import { EXTERNAL_CONTENT_EMBED_SLICE_CHARS } from "./external-content.ts";
import { TRANSCRIPT_EMBED_SLICE_CHARS } from "./transcripts.ts";

const CONCURRENCY = 4;

export type IngestResult = {
  user_id: number;
  channel_count: number;
  block_count: number;
  link_count: number;
  failed_channels: string[];
};

type ChannelFetch = {
  channel: ArenaChannel;
  blocks: ArenaBlock[];
};

export type IngestDeps = {
  getUser?: (slug: string) => Promise<ArenaUser>;
  getAllUserChannels?: (slug: string) => Promise<ArenaChannel[]>;
  getAllChannelBlocks?: (idOrSlug: string | number) => Promise<ArenaBlock[]>;
  db?: Database.Database;
};

function pickRichPlain(r: { plain?: string | null; markdown?: string | null } | null | undefined) {
  if (!r) return null;
  return r.plain ?? r.markdown ?? null;
}

function pickRichHtml(r: { html?: string | null } | null | undefined) {
  if (!r) return null;
  return r.html ?? null;
}


async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    });
  await Promise.all(runners);
  return results;
}

export async function ingestUser(
  slug: string,
  deps: IngestDeps = {},
): Promise<IngestResult> {
  const fetchUser = deps.getUser ?? getUser;
  const fetchChannels = deps.getAllUserChannels ?? getAllUserChannels;
  const fetchChannelBlocks = deps.getAllChannelBlocks ?? getAllChannelBlocks;

  const user: ArenaUser = await fetchUser(slug);
  const channels = await fetchChannels(slug);

  const failed: string[] = [];
  const fetched = await runPool<ArenaChannel, ChannelFetch | null>(
    channels,
    CONCURRENCY,
    async (c) => {
      try {
        const blocks = await fetchChannelBlocks(c.slug);
        return { channel: c, blocks };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`ingest: getAllChannelBlocks(${c.slug}) failed: ${msg}`);
        failed.push(c.slug);
        return null;
      }
    },
  );

  const db = deps.db ?? getDb();

  const upsertUser = db.prepare(`
    INSERT INTO users (
      arena_user_id, arena_username, profile_url, slug, full_name,
      avatar_url, indexed_at
    ) VALUES (
      @arena_user_id, @arena_username, @profile_url, @slug, @full_name,
      @avatar_url, datetime('now')
    )
    ON CONFLICT(arena_username) DO UPDATE SET
      arena_user_id = excluded.arena_user_id,
      profile_url   = excluded.profile_url,
      slug          = excluded.slug,
      full_name     = excluded.full_name,
      avatar_url    = excluded.avatar_url,
      indexed_at    = excluded.indexed_at
  `);

  const upsertChannel = db.prepare(`
    INSERT INTO channels (
      arena_channel_id, user_id, title, description, visibility, url, slug
    ) VALUES (
      @arena_channel_id, @user_id, @title, @description, @visibility, @url, @slug
    )
    ON CONFLICT(arena_channel_id) DO UPDATE SET
      user_id     = excluded.user_id,
      title       = excluded.title,
      description = excluded.description,
      visibility  = excluded.visibility,
      url         = excluded.url,
      slug        = excluded.slug
    RETURNING id
  `);

  const upsertBlock = db.prepare(`
    INSERT INTO blocks (
      arena_block_id, title, description, block_type, source_url,
      source_provider_name, source_provider_url,
      image_url, image_thumb_url, image_display_url, image_original_url,
      content_text, content_html, search_text, arena_url,
      created_at, updated_at
    ) VALUES (
      @arena_block_id, @title, @description, @block_type, @source_url,
      @source_provider_name, @source_provider_url,
      @image_url, @image_thumb_url, @image_display_url, @image_original_url,
      @content_text, @content_html, @search_text, @arena_url,
      @created_at, @updated_at
    )
    ON CONFLICT(arena_block_id) DO UPDATE SET
      title                = excluded.title,
      description          = excluded.description,
      block_type           = excluded.block_type,
      source_url           = excluded.source_url,
      source_provider_name = excluded.source_provider_name,
      source_provider_url  = excluded.source_provider_url,
      image_url            = excluded.image_url,
      image_thumb_url      = excluded.image_thumb_url,
      image_display_url    = excluded.image_display_url,
      image_original_url   = excluded.image_original_url,
      content_text         = excluded.content_text,
      content_html         = excluded.content_html,
      search_text          = excluded.search_text,
      arena_url            = excluded.arena_url,
      created_at           = excluded.created_at,
      updated_at           = excluded.updated_at
    RETURNING id
  `);

  const upsertLink = db.prepare(`
    INSERT OR REPLACE INTO block_channels (
      block_id, channel_id, position, connected_at
    ) VALUES (?, ?, ?, ?)
  `);

  const findUserByUsername = db.prepare(
    `SELECT id FROM users WHERE arena_username = ?`,
  );

  const insertSyncLog = db.prepare(`
    INSERT INTO sync_logs (user_id, status, message, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `);

  const result = db.transaction((): IngestResult => {
    upsertUser.run({
      arena_user_id: user.id,
      arena_username: user.slug,
      profile_url: `https://www.are.na/${user.slug}`,
      slug: user.slug,
      full_name: user.name ?? null,
      avatar_url: (user as { avatar?: string }).avatar ?? null,
    });
    const userRow = findUserByUsername.get(user.slug) as { id: number };
    const userId = userRow.id;

    // Build a per-block channel-titles map so search_text reflects every
    // channel the block lives in within this ingest pass.
    const channelTitlesByBlockId = new Map<number, string[]>();
    for (const fc of fetched) {
      if (!fc) continue;
      const title = fc.channel.title;
      if (!title) continue;
      for (const b of fc.blocks) {
        const list = channelTitlesByBlockId.get(b.id);
        if (list) list.push(title);
        else channelTitlesByBlockId.set(b.id, [title]);
      }
    }

    // Existing OCR (if any) must be preserved through re-ingest. Pull it
    // by arena_block_id so we can fold it back into the recomputed
    // search_text for the same block.
    const ocrByArenaId = new Map<
      number,
      { ocr_text: string | null; ocr_summary: string | null }
    >();
    const ocrRows = db
      .prepare(
        `SELECT b.arena_block_id, o.ocr_text, o.ocr_summary
           FROM block_ocr o
           JOIN blocks b ON b.id = o.block_id
          WHERE o.ocr_processed_at IS NOT NULL`,
      )
      .all() as Array<{
      arena_block_id: number;
      ocr_text: string | null;
      ocr_summary: string | null;
    }>;
    for (const r of ocrRows) {
      ocrByArenaId.set(r.arena_block_id, {
        ocr_text: r.ocr_text,
        ocr_summary: r.ocr_summary,
      });
    }

    // Same idea for external-content extractions: preserve fetched Jina
    // bodies through re-ingest so we don't have to re-fetch.
    const externalContentByArenaId = new Map<number, string | null>();
    const externalRows = db
      .prepare(
        `SELECT b.arena_block_id, c.content_text
           FROM block_link_content c
           JOIN blocks b ON b.id = c.block_id
          WHERE c.fetched_at IS NOT NULL AND c.content_text IS NOT NULL`,
      )
      .all() as Array<{ arena_block_id: number; content_text: string | null }>;
    for (const r of externalRows) {
      externalContentByArenaId.set(r.arena_block_id, r.content_text);
    }

    // Same idea for YouTube transcripts: keep fetched yt-dlp bodies
    // through re-ingest so search_text can include them again.
    const transcriptByArenaId = new Map<number, string | null>();
    const transcriptRows = db
      .prepare(
        `SELECT b.arena_block_id, t.transcript_text
           FROM block_transcripts t
           JOIN blocks b ON b.id = t.block_id
          WHERE t.fetched_at IS NOT NULL AND t.transcript_text IS NOT NULL`,
      )
      .all() as Array<{ arena_block_id: number; transcript_text: string | null }>;
    for (const r of transcriptRows) {
      transcriptByArenaId.set(r.arena_block_id, r.transcript_text);
    }

    let channelCount = 0;
    let blockCount = 0;
    let linkCount = 0;

    for (const fc of fetched) {
      if (!fc) continue;
      const c = fc.channel;
      const visibility =
        (c as { visibility?: string }).visibility ??
        (c as { status?: string }).status ??
        null;
      const rawDesc = (c as { description?: unknown }).description;
      const channelDescription =
        rawDesc && typeof rawDesc === "object"
          ? pickRichPlain(rawDesc as { plain?: string | null; markdown?: string | null })
          : typeof rawDesc === "string"
            ? rawDesc
            : null;
      const channelUrl = `https://www.are.na/${user.slug}/${c.slug}`;
      const row = upsertChannel.get({
        arena_channel_id: c.id,
        user_id: userId,
        title: c.title ?? null,
        description: channelDescription,
        visibility,
        url: channelUrl,
        slug: c.slug,
      }) as { id: number };
      const channelId = row.id;
      channelCount += 1;

      for (const b of fc.blocks) {
        const isText = b.type === "Text";
        const contentText = pickRichPlain(b.content);
        const contentHtml = pickRichHtml(b.content);
        const descriptionText = isText
          ? pickRichPlain(b.description)
          : pickRichPlain(b.description);
        const blockRow = upsertBlock.get({
          arena_block_id: b.id,
          title:
            typeof b.title === "string" && b.title.trim()
              ? b.title
              : b.generated_title ?? null,
          description: descriptionText,
          block_type: typeof b.type === "string" ? b.type : null,
          source_url: b.source?.url ?? null,
          source_provider_name: b.source?.provider?.name ?? null,
          source_provider_url: b.source?.provider?.url ?? null,
          image_url: b.image?.src ?? b.image?.large?.src ?? null,
          image_thumb_url: b.image?.small?.src ?? null,
          image_display_url: b.image?.large?.src ?? b.image?.medium?.src ?? null,
          image_original_url: b.image?.src ?? null,
          content_text: contentText,
          content_html: contentHtml,
          search_text: buildSearchText({
            title:
              typeof b.title === "string" && b.title.trim()
                ? b.title.trim()
                : (b.generated_title ?? null),
            description: descriptionText,
            content_text: contentText,
            ocr_text: ocrByArenaId.get(b.id)?.ocr_text ?? null,
            ocr_summary: ocrByArenaId.get(b.id)?.ocr_summary ?? null,
            external_content:
              (externalContentByArenaId.get(b.id) ?? null) === null
                ? null
                : (externalContentByArenaId.get(b.id) as string).slice(
                    0,
                    EXTERNAL_CONTENT_EMBED_SLICE_CHARS,
                  ),
            transcript_text:
              (transcriptByArenaId.get(b.id) ?? null) === null
                ? null
                : (transcriptByArenaId.get(b.id) as string).slice(
                    0,
                    TRANSCRIPT_EMBED_SLICE_CHARS,
                  ),
            block_type: typeof b.type === "string" ? b.type : null,
            source_provider_name: b.source?.provider?.name ?? null,
            channel_titles: channelTitlesByBlockId.get(b.id) ?? [],
          }),
          arena_url: `https://www.are.na/block/${b.id}`,
          created_at: (b as { created_at?: string }).created_at ?? null,
          updated_at: (b as { updated_at?: string }).updated_at ?? null,
        }) as { id: number };
        blockCount += 1;

        upsertLink.run(
          blockRow.id,
          channelId,
          b.position ?? null,
          b.connected_at ?? null,
        );
        linkCount += 1;
      }
    }

    const status: "ok" | "partial" | "error" =
      failed.length === 0 ? "ok" : "partial";
    const message = JSON.stringify({
      channel_count: channelCount,
      block_count: blockCount,
      link_count: linkCount,
      failed_channels: failed,
    });
    insertSyncLog.run(userId, status, message);

    return {
      user_id: userId,
      channel_count: channelCount,
      block_count: blockCount,
      link_count: linkCount,
      failed_channels: failed,
    };
  });

  return result.immediate();
}

// Best-effort error log when ingest itself blows up before the main txn.
// Swallows any DB failure — the route still returns the upstream error.
export function logIngestError(slug: string, err: unknown): void {
  try {
    const db = getDb();
    const userRow = db
      .prepare(`SELECT id FROM users WHERE arena_username = ?`)
      .get(slug) as { id: number } | undefined;
    const status = err instanceof ArenaError ? "error" : "error";
    const message = JSON.stringify({
      slug,
      error: err instanceof Error ? err.message : String(err),
      arena_status: err instanceof ArenaError ? err.status : undefined,
    });
    db.prepare(
      `INSERT INTO sync_logs (user_id, status, message, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
    ).run(userRow?.id ?? null, status, message);
  } catch {
    // swallow
  }
}
