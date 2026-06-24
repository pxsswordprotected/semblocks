import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";

import {
  buildJsonExportForBlockIds,
  getExportBlockIdsForChannels,
  parseExportChannelIds,
} from "./json-export.ts";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arena_block_id INTEGER UNIQUE NOT NULL,
      title TEXT,
      description TEXT,
      block_type TEXT,
      source_url TEXT,
      content_text TEXT,
      search_text TEXT,
      arena_url TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      url TEXT,
      slug TEXT
    );
    CREATE TABLE block_channels (
      block_id INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      position INTEGER,
      connected_at TEXT,
      PRIMARY KEY (block_id, channel_id)
    );
    CREATE TABLE block_ocr (
      block_id INTEGER PRIMARY KEY,
      ocr_text TEXT,
      ocr_summary TEXT
    );
    CREATE TABLE block_link_content (
      block_id INTEGER PRIMARY KEY,
      url TEXT,
      content_text TEXT
    );
    CREATE TABLE block_transcripts (
      block_id INTEGER PRIMARY KEY,
      transcript_text TEXT
    );
  `);
  return db;
}

function seedDb(db: Database.Database) {
  db.prepare(
    `INSERT INTO blocks (
       id, arena_block_id, title, description, block_type, source_url,
       content_text, search_text, arena_url, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    1,
    101,
    "First title",
    "First description",
    "Link",
    "https://example.com/first",
    "Stored content",
    "Do not include search text when richer content exists",
    "https://www.are.na/block/101",
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO blocks (
       id, arena_block_id, title, description, block_type, source_url,
       content_text, search_text, arena_url, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    2,
    102,
    null,
    null,
    "Image",
    null,
    null,
    "Only searchable fallback",
    "https://www.are.na/block/102",
    "2026-01-03T00:00:00.000Z",
    "2026-01-04T00:00:00.000Z",
  );
  db.prepare(
    `INSERT INTO channels (id, title, url, slug) VALUES (?, ?, ?, ?)`,
  ).run(10, "Design", "https://www.are.na/user/design", "design");
  db.prepare(
    `INSERT INTO channels (id, title, url, slug) VALUES (?, ?, ?, ?)`,
  ).run(11, "Research", "https://www.are.na/user/research", "research");
  db.prepare(
    `INSERT INTO block_channels (block_id, channel_id, position, connected_at)
     VALUES (?, ?, ?, ?)`,
  ).run(1, 10, 1, "2026-01-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO block_channels (block_id, channel_id, position, connected_at)
     VALUES (?, ?, ?, ?)`,
  ).run(1, 11, 2, "2026-01-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO block_channels (block_id, channel_id, position, connected_at)
     VALUES (?, ?, ?, ?)`,
  ).run(2, 10, 3, "2026-01-03T00:00:00.000Z");
  db.prepare(
    `INSERT INTO block_ocr (block_id, ocr_text, ocr_summary) VALUES (?, ?, ?)`,
  ).run(1, "OCR text", "OCR summary");
  db.prepare(
    `INSERT INTO block_link_content (block_id, url, content_text) VALUES (?, ?, ?)`,
  ).run(1, "https://example.com/first", "External article text");
  db.prepare(
    `INSERT INTO block_transcripts (block_id, transcript_text) VALUES (?, ?)`,
  ).run(1, "Transcript text");
}

test("buildJsonExportForBlockIds returns lightweight ordered content export", () => {
  const db = makeDb();
  seedDb(db);
  const beforeBlocks = rowCount(db, "blocks");
  const beforeChannels = rowCount(db, "block_channels");

  const payload = buildJsonExportForBlockIds({
    blockIds: [2, 1, 2, 999],
    scope: { type: "all" },
    db,
  });

  assert.equal(payload.schema_version, 1);
  assert.equal(payload.source, "semblocks");
  assert.equal(payload.block_count, 2);
  assert.deepEqual(payload.blocks.map((block) => block.id), [2, 1]);

  const fallbackBlock = payload.blocks[0];
  assert.equal(fallbackBlock.arena_id, 102);
  assert.equal(fallbackBlock.content, "Only searchable fallback");
  assert.deepEqual(fallbackBlock.content_sources, ["search_text"]);

  const richBlock = payload.blocks[1];
  assert.equal(richBlock.arena_id, 101);
  assert.deepEqual(richBlock.channels, [
    { id: 10, title: "Design", url: "https://www.are.na/user/design" },
    { id: 11, title: "Research", url: "https://www.are.na/user/research" },
  ]);
  assert.deepEqual(richBlock.content_sources, [
    "title",
    "description",
    "content_text",
    "ocr_summary",
    "ocr_text",
    "link_content",
    "transcript",
  ]);
  assert.equal(
    richBlock.content,
    [
      "First title",
      "First description",
      "Stored content",
      "OCR summary",
      "OCR text",
      "External article text",
      "Transcript text",
    ].join("\n\n"),
  );
  assert.equal(Object.hasOwn(richBlock, "search_text"), false);
  assert.equal(Object.hasOwn(richBlock, "embedding"), false);
  assert.equal(Object.hasOwn(richBlock, "distance"), false);

  assert.equal(rowCount(db, "blocks"), beforeBlocks);
  assert.equal(rowCount(db, "block_channels"), beforeChannels);
});

test("getExportBlockIdsForChannels preserves recency order and dedupes inputs", () => {
  const db = makeDb();
  seedDb(db);

  assert.deepEqual(getExportBlockIdsForChannels([10, 10, -1], db), [2, 1]);
  assert.deepEqual(getExportBlockIdsForChannels([11], db), [1]);
  assert.deepEqual(getExportBlockIdsForChannels([], db), []);
});

test("parseExportChannelIds strictly accepts positive integer CSV", () => {
  assert.deepEqual(parseExportChannelIds("1, 2,003,1"), [1, 2, 3]);
  assert.equal(parseExportChannelIds(null), null);
  assert.equal(parseExportChannelIds(""), null);
  assert.equal(parseExportChannelIds("1,,2"), null);
  assert.equal(parseExportChannelIds("1,abc"), null);
  assert.equal(parseExportChannelIds("0"), null);
});

function rowCount(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}
