import type Database from "better-sqlite3";
import { getDb } from "./db.ts";
import type { Hit } from "./search-core.ts";
import type { ChannelRecResult } from "./recommend-core.ts";

type Db = Database.Database;

export type DemoSearchKind = "search" | "rec";

// Stored result payloads. `search` mirrors /api/search GET; `rec` mirrors
// /api/recommend-channel. caption_meta is present for image-sourced demos.
export type DemoSearchResult = { query: string; hits: Hit[] };
export type DemoRecResult = ChannelRecResult & {
  caption_meta?: { ocr_text: string; ocr_summary: string | null };
};

export type DemoSearchSummary = {
  id: string;
  kind: DemoSearchKind;
  label: string;
  is_image: boolean;
  sort_order: number;
};

export type DemoSearch = DemoSearchSummary & {
  query_text: string;
  created_at: string;
  result: DemoSearchResult | DemoRecResult;
};

type DemoSearchRow = {
  id: string;
  kind: DemoSearchKind;
  label: string;
  query_text: string;
  is_image: number;
  result_json: string;
  sort_order: number;
  created_at: string;
};

function dbOrDefault(db?: Db): Db {
  return db ?? getDb();
}

function toSummary(row: DemoSearchRow): DemoSearchSummary {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    is_image: row.is_image === 1,
    sort_order: row.sort_order,
  };
}

export function listDemoSearches(
  kind?: DemoSearchKind,
  db?: Db,
): DemoSearchSummary[] {
  const store = dbOrDefault(db);
  const rows = kind
    ? (store
        .prepare(
          `SELECT id, kind, label, query_text, is_image, result_json, sort_order, created_at
             FROM demo_searches
            WHERE kind = ?
            ORDER BY sort_order ASC, label ASC`,
        )
        .all(kind) as DemoSearchRow[])
    : (store
        .prepare(
          `SELECT id, kind, label, query_text, is_image, result_json, sort_order, created_at
             FROM demo_searches
            ORDER BY kind ASC, sort_order ASC, label ASC`,
        )
        .all() as DemoSearchRow[]);
  return rows.map(toSummary);
}

export function getDemoSearch(id: string, db?: Db): DemoSearch | null {
  const row = dbOrDefault(db)
    .prepare(
      `SELECT id, kind, label, query_text, is_image, result_json, sort_order, created_at
         FROM demo_searches
        WHERE id = ?`,
    )
    .get(id) as DemoSearchRow | undefined;
  if (!row) return null;

  return {
    ...toSummary(row),
    query_text: row.query_text,
    created_at: row.created_at,
    result: JSON.parse(row.result_json) as DemoSearchResult | DemoRecResult,
  };
}

export type UpsertDemoSearchInput = {
  id: string;
  kind: DemoSearchKind;
  label: string;
  query_text: string;
  is_image?: boolean;
  sort_order?: number;
  result: DemoSearchResult | DemoRecResult;
  db?: Db;
};

export function upsertDemoSearch(input: UpsertDemoSearchInput): void {
  const store = dbOrDefault(input.db);
  store
    .prepare(
      `INSERT INTO demo_searches (
         id, kind, label, query_text, is_image, result_json, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         label = excluded.label,
         query_text = excluded.query_text,
         is_image = excluded.is_image,
         result_json = excluded.result_json,
         sort_order = excluded.sort_order`,
    )
    .run(
      input.id,
      input.kind,
      input.label,
      input.query_text,
      input.is_image ? 1 : 0,
      JSON.stringify(input.result),
      input.sort_order ?? 0,
      new Date().toISOString(),
    );
}
