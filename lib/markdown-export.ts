import type Database from "better-sqlite3";
import { getDb } from "./db.ts";
import type { SearchFilterOptions } from "./search-filters.ts";

export type MarkdownExportScope =
  | { type: "all" }
  | { type: "channels"; channel_ids: number[] }
  | {
      type: "search";
      query: string;
      limit: number;
      filters: SearchFilterOptions;
      channel_ids: number[] | null;
    };

export type MarkdownExportBlock = {
  id: number;
  date: string | null;
  arena_url: string | null;
  content: string;
};

export type MarkdownExportDocument = {
  exported_at: string;
  scope: MarkdownExportScope;
  block_count: number;
  blocks: MarkdownExportBlock[];
};

type Db = Database.Database;

type IdRow = { id: number };

type BlockRow = {
  id: number;
  title: string | null;
  description: string | null;
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

type ContentPart = {
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

export function buildMarkdownExportForBlockIds({
  blockIds,
  scope,
  db = getDb(),
}: {
  blockIds: number[];
  scope: MarkdownExportScope;
  db?: Db;
}): MarkdownExportDocument {
  const ids = uniquePositiveIntegers(blockIds);

  const blocks = db.transaction(() => {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(",");
    const blockRows = db
      .prepare(
        `SELECT b.id,
                b.title,
                b.description,
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

    const rowsById = new Map(blockRows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = rowsById.get(id);
      if (!row) return [];
      return [toExportBlock(row)];
    });
  })();

  return {
    exported_at: new Date().toISOString(),
    scope,
    block_count: blocks.length,
    blocks,
  };
}

export function markdownExportResponse(
  document: MarkdownExportDocument,
  filenameStem: string,
): Response {
  const filename = `${safeFilenameStem(filenameStem)}-${dateStamp()}.md`;
  return new Response(renderMarkdownExport(document), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function renderMarkdownExport(document: MarkdownExportDocument): string {
  const lines: string[] = [
    "# Semblocks export",
    "",
    `exported_at: ${document.exported_at}`,
    `block_count: ${document.block_count}`,
    "",
  ];

  for (const block of document.blocks) {
    lines.push(
      `## ${block.id}`,
      `date: ${block.date ?? ""}`,
      `arena_url: ${block.arena_url ?? ""}`,
      "",
      block.content,
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function toExportBlock(row: BlockRow): MarkdownExportBlock {
  const baseParts: ContentPart[] = [
    { text: row.title },
    { text: row.description },
    { text: row.content_text },
    { text: row.ocr_summary },
    { text: row.ocr_text },
    { text: row.link_content_text },
    { text: row.transcript_text },
  ];

  let content = contentFromParts(baseParts);
  if (!content && hasText(row.search_text)) content = row.search_text!.trim();

  return {
    id: row.id,
    date: row.created_at ?? row.updated_at,
    arena_url: row.arena_url,
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
