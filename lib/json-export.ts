import type Database from "better-sqlite3";
import { getDb } from "./db.ts";
import type { SearchFilterOptions } from "./search-filters.ts";

export type JsonExportScope =
  | { type: "all" }
  | { type: "channels"; channel_ids: number[] }
  | {
      type: "search";
      query: string;
      limit: number;
      filters: SearchFilterOptions;
      channel_ids: number[] | null;
    };

export type JsonExportChannel = {
  id: number;
  title: string | null;
  url: string | null;
};

export type JsonExportBlock = {
  id: number;
  arena_id: number;
  title: string | null;
  description: string | null;
  type: string | null;
  url: string | null;
  arena_url: string | null;
  channels: JsonExportChannel[];
  created_at: string | null;
  updated_at: string | null;
  content_sources: string[];
  content: string;
};

export type JsonExportPayload = {
  schema_version: 1;
  source: "semblocks";
  exported_at: string;
  scope: JsonExportScope;
  block_count: number;
  blocks: JsonExportBlock[];
};

type Db = Database.Database;

type IdRow = { id: number };

type BlockRow = {
  id: number;
  arena_block_id: number;
  title: string | null;
  description: string | null;
  block_type: string | null;
  source_url: string | null;
  search_text: string | null;
  content_text: string | null;
  arena_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  ocr_summary: string | null;
  ocr_text: string | null;
  link_content_text: string | null;
  transcript_text: string | null;
};

type ChannelRow = {
  block_id: number;
  id: number;
  title: string | null;
  url: string | null;
};

type ContentPart = {
  source: string;
  text: string | null;
};

export function getAllExportBlockIds(db: Db = getDb()): number[] {
  return (
    db
      .prepare(
        `SELECT id
           FROM blocks
          ORDER BY created_at DESC, id DESC`,
      )
      .all() as IdRow[]
  ).map((row) => row.id);
}

export function getExportBlockIdsForChannels(
  channelIds: number[],
  db: Db = getDb(),
): number[] {
  const ids = uniquePositiveIntegers(channelIds);
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  return (
    db
      .prepare(
        `SELECT DISTINCT b.id
           FROM blocks b
           JOIN block_channels bc ON bc.block_id = b.id
          WHERE bc.channel_id IN (${placeholders})
          ORDER BY b.created_at DESC, b.id DESC`,
      )
      .all(...ids) as IdRow[]
  ).map((row) => row.id);
}

export function parseExportChannelIds(raw: string | null): number[] | null {
  if (raw === null) return null;

  const parts = raw.split(",");
  if (parts.length === 0) return null;

  const ids: number[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) return null;
    const id = Number(trimmed);
    if (!Number.isInteger(id) || id <= 0) return null;
    ids.push(id);
  }

  const unique = uniquePositiveIntegers(ids);
  return unique.length > 0 ? unique : null;
}

export function buildJsonExportForBlockIds({
  blockIds,
  scope,
  db = getDb(),
}: {
  blockIds: number[];
  scope: JsonExportScope;
  db?: Db;
}): JsonExportPayload {
  const ids = uniquePositiveIntegers(blockIds);

  const blocks = db.transaction(() => {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(",");
    const blockRows = db
      .prepare(
        `SELECT b.id,
                b.arena_block_id,
                b.title,
                b.description,
                b.block_type,
                b.source_url,
                b.search_text,
                b.content_text,
                b.arena_url,
                b.created_at,
                b.updated_at,
                o.ocr_summary,
                o.ocr_text,
                lc.content_text AS link_content_text,
                t.transcript_text
           FROM blocks b
           LEFT JOIN block_ocr o ON o.block_id = b.id
           LEFT JOIN block_link_content lc ON lc.block_id = b.id
           LEFT JOIN block_transcripts t ON t.block_id = b.id
          WHERE b.id IN (${placeholders})`,
      )
      .all(...ids) as BlockRow[];

    const channelRows = db
      .prepare(
        `SELECT bc.block_id, c.id, c.title, c.url
           FROM block_channels bc
           JOIN channels c ON c.id = bc.channel_id
          WHERE bc.block_id IN (${placeholders})
          ORDER BY bc.block_id, lower(c.title), c.id`,
      )
      .all(...ids) as ChannelRow[];

    const channelsByBlock = new Map<number, JsonExportChannel[]>();
    for (const row of channelRows) {
      const channels = channelsByBlock.get(row.block_id);
      const channel = { id: row.id, title: row.title, url: row.url };
      if (channels) channels.push(channel);
      else channelsByBlock.set(row.block_id, [channel]);
    }

    const rowsById = new Map(blockRows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = rowsById.get(id);
      if (!row) return [];
      return [toExportBlock(row, channelsByBlock.get(id) ?? [])];
    });
  })();

  return {
    schema_version: 1,
    source: "semblocks",
    exported_at: new Date().toISOString(),
    scope,
    block_count: blocks.length,
    blocks,
  };
}

export function jsonExportResponse(
  payload: JsonExportPayload,
  filenameStem: string,
): Response {
  const filename = `${safeFilenameStem(filenameStem)}-${dateStamp()}.json`;
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function toExportBlock(
  row: BlockRow,
  channels: JsonExportChannel[],
): JsonExportBlock {
  const baseParts: ContentPart[] = [
    { source: "title", text: row.title },
    { source: "description", text: row.description },
    { source: "content_text", text: row.content_text },
    { source: "ocr_summary", text: row.ocr_summary },
    { source: "ocr_text", text: row.ocr_text },
    { source: "link_content", text: row.link_content_text },
    { source: "transcript", text: row.transcript_text },
  ];

  let content = contentFromParts(baseParts);
  let contentSources = baseParts
    .filter((part) => hasText(part.text))
    .map((part) => part.source);

  if (!content && hasText(row.search_text)) {
    content = row.search_text!.trim();
    contentSources = ["search_text"];
  }

  return {
    id: row.id,
    arena_id: row.arena_block_id,
    title: row.title,
    description: row.description,
    type: row.block_type,
    url: row.source_url,
    arena_url: row.arena_url,
    channels,
    created_at: row.created_at,
    updated_at: row.updated_at,
    content_sources: contentSources,
    content,
  };
}

function contentFromParts(parts: ContentPart[]): string {
  return parts
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function hasText(value: string | null): boolean {
  return Boolean(value?.trim());
}

function uniquePositiveIntegers(values: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    if (!Number.isInteger(value) || value <= 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function safeFilenameStem(stem: string): string {
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "semblocks-export";
}

function dateStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
