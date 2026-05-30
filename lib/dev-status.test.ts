import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { getDevStatus } from "./dev-status.ts";

function createDevStatusDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arena_username TEXT UNIQUE NOT NULL,
      full_name TEXT,
      indexed_at TEXT
    );
    CREATE TABLE channels (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_text TEXT
    );
    CREATE TABLE vec_blocks (
      block_id INTEGER PRIMARY KEY,
      embedding_model TEXT,
      created_at TEXT
    );
    CREATE TABLE sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT,
      message TEXT,
      created_at TEXT
    );
    CREATE TABLE block_ocr (
      block_id INTEGER PRIMARY KEY,
      ocr_error TEXT
    );
    CREATE TABLE block_link_content (
      block_id INTEGER PRIMARY KEY,
      error TEXT
    );
    CREATE TABLE block_transcripts (
      block_id INTEGER PRIMARY KEY,
      error TEXT
    );
    CREATE TABLE block_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id INTEGER NOT NULL,
      chunk_type TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      source_start_char INTEGER NOT NULL,
      source_end_char INTEGER NOT NULL
    );
    CREATE TABLE vec_block_chunks (
      chunk_id INTEGER PRIMARY KEY,
      embedding_model TEXT,
      created_at TEXT
    );
  `);
  return db;
}

test("summarizes profile, counts, missing embeddings, and logs", () => {
  const db = createDevStatusDb();
  try {
    db.exec(`
      INSERT INTO users (arena_username, full_name, indexed_at) VALUES
        ('older-user', 'Older User', '2025-01-01T00:00:00Z'),
        ('j-arab1hdgxzs', 'Joe Arab', '2025-05-27T14:32:00Z');

      INSERT INTO channels DEFAULT VALUES;
      INSERT INTO channels DEFAULT VALUES;

      INSERT INTO blocks (id, search_text) VALUES
        (1, 'first indexed block'),
        (2, 'needs embedding'),
        (3, ''),
        (4, '   '),
        (5, NULL);
      INSERT INTO vec_blocks (block_id, embedding_model, created_at)
        VALUES (1, 'text-embedding-3-small', '2025-05-27T14:33:00Z');

      INSERT INTO block_ocr (block_id, ocr_error) VALUES
        (1, NULL),
        (2, 'image failed'),
        (3, '');
      INSERT INTO block_link_content (block_id, error) VALUES
        (1, NULL),
        (2, 'extract failed');
      INSERT INTO block_transcripts (block_id, error) VALUES
        (1, 'subtitle missing'),
        (2, '   ');

      INSERT INTO block_chunks
        (block_id, chunk_type, chunk_index, text, source_start_char, source_end_char)
        VALUES
        (1, 'base', 0, 'first', 0, 5),
        (2, 'external_content', 0, 'second', 0, 6);
      INSERT INTO vec_block_chunks (chunk_id, embedding_model, created_at)
        VALUES (1, 'text-embedding-3-small', '2025-05-27T14:34:00Z');

      INSERT INTO sync_logs (status, message, created_at) VALUES
        ('error', 'first failed', '2025-05-27T14:30:00Z'),
        ('ok', 'finished', '2025-05-27T14:35:00Z');
    `);

    const status = getDevStatus(db);

    assert.deepEqual(status.profile, {
      username: "j-arab1hdgxzs",
      name: "Joe Arab",
      indexed_at: "2025-05-27T14:32:00Z",
    });
    assert.deepEqual(status.last_sync, {
      status: "ok",
      message: "finished",
      created_at: "2025-05-27T14:35:00Z",
    });
    assert.deepEqual(status.counts, {
      channels: 2,
      blocks: 5,
      embeddings: 1,
      embeddable_blocks: 2,
      missing_embeddings: 1,
      ocr_rows: 3,
      ocr_errors: 1,
      external_content_rows: 2,
      external_content_errors: 1,
      transcript_rows: 2,
      transcript_errors: 1,
      chunks: 2,
      chunk_embeddings: 1,
    });
    assert.deepEqual(
      status.logs.map((log) => log.status),
      ["ok", "error"],
    );
  } finally {
    db.close();
  }
});

test("returns null metadata and zero error counts for empty dev status tables", () => {
  const db = createDevStatusDb();
  try {
    const status = getDevStatus(db);

    assert.equal(status.profile, null);
    assert.equal(status.last_sync, null);
    assert.deepEqual(status.counts, {
      channels: 0,
      blocks: 0,
      embeddings: 0,
      embeddable_blocks: 0,
      missing_embeddings: 0,
      ocr_rows: 0,
      ocr_errors: 0,
      external_content_rows: 0,
      external_content_errors: 0,
      transcript_rows: 0,
      transcript_errors: 0,
      chunks: 0,
      chunk_embeddings: 0,
    });
    assert.deepEqual(status.logs, []);
  } finally {
    db.close();
  }
});
