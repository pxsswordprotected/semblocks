import type Database from "better-sqlite3";
import { getDb } from "./db.ts";

export type DevStatusProfile = {
  username: string | null;
  name: string | null;
  indexed_at: string | null;
};

export type DevStatusSync = {
  status: string | null;
  message: string | null;
  created_at: string | null;
};

export type DevStatusCounts = {
  channels: number;
  blocks: number;
  embeddings: number;
  embeddable_blocks: number;
  missing_embeddings: number;
  ocr_rows: number;
  ocr_errors: number;
  external_content_rows: number;
  external_content_errors: number;
  transcript_rows: number;
  transcript_errors: number;
  chunks: number;
  chunk_embeddings: number;
};

export type DevStatusLog = {
  id: number;
  status: string | null;
  message: string | null;
  created_at: string | null;
};

export type DevStatusResponse = {
  profile: DevStatusProfile | null;
  last_sync: DevStatusSync | null;
  counts: DevStatusCounts;
  logs: DevStatusLog[];
};

type CountRow = {
  channels: number;
  blocks: number;
  embeddings: number;
  embeddable_blocks: number;
  missing_embeddings: number;
  ocr_rows: number;
  ocr_errors: number;
  external_content_rows: number;
  external_content_errors: number;
  transcript_rows: number;
  transcript_errors: number;
  chunks: number;
  chunk_embeddings: number;
};

function countNonEmpty(column: string): string {
  return `COALESCE(SUM(CASE WHEN ${column} IS NOT NULL AND trim(${column}) <> '' THEN 1 ELSE 0 END), 0)`;
}

export function getDevStatus(db: Database.Database = getDb()): DevStatusResponse {
  const profile = db
    .prepare(
      `SELECT arena_username AS username,
              full_name AS name,
              indexed_at
         FROM users
     ORDER BY indexed_at DESC, id DESC
        LIMIT 1`,
    )
    .get() as DevStatusProfile | undefined;

  const lastSync = db
    .prepare(
      `SELECT status, message, created_at
         FROM sync_logs
     ORDER BY id DESC
        LIMIT 1`,
    )
    .get() as DevStatusSync | undefined;

  const counts = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM channels) AS channels,
        (SELECT COUNT(*) FROM blocks) AS blocks,
        (SELECT COUNT(*) FROM vec_blocks) AS embeddings,
        (SELECT COUNT(*)
           FROM blocks
          WHERE search_text IS NOT NULL AND trim(search_text) <> '') AS embeddable_blocks,
        (SELECT COUNT(*)
           FROM blocks b
          WHERE b.search_text IS NOT NULL
            AND trim(b.search_text) <> ''
            AND NOT EXISTS (
              SELECT 1
                FROM vec_blocks v
               WHERE v.block_id = b.id
            )) AS missing_embeddings,
        (SELECT COUNT(*) FROM block_ocr) AS ocr_rows,
        (SELECT ${countNonEmpty("ocr_error")} FROM block_ocr) AS ocr_errors,
        (SELECT COUNT(*) FROM block_link_content) AS external_content_rows,
        (SELECT ${countNonEmpty("error")} FROM block_link_content) AS external_content_errors,
        (SELECT COUNT(*) FROM block_transcripts) AS transcript_rows,
        (SELECT ${countNonEmpty("error")} FROM block_transcripts) AS transcript_errors,
        (SELECT COUNT(*) FROM block_chunks) AS chunks,
        (SELECT COUNT(*) FROM vec_block_chunks) AS chunk_embeddings`,
    )
    .get() as CountRow;

  const logs = db
    .prepare(
      `SELECT id, status, message, created_at
         FROM sync_logs
     ORDER BY id DESC
        LIMIT 12`,
    )
    .all() as DevStatusLog[];

  return {
    profile: profile ?? null,
    last_sync: lastSync ?? null,
    counts,
    logs,
  };
}
