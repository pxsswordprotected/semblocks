import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { ingestUser } from "./ingest.ts";
import type { ArenaBlock, ArenaChannel, ArenaUser } from "./arena.ts";

function createIngestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arena_user_id INTEGER UNIQUE,
      arena_username TEXT UNIQUE NOT NULL,
      profile_url TEXT,
      slug TEXT,
      full_name TEXT,
      avatar_url TEXT,
      indexed_at TEXT
    );
    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arena_channel_id INTEGER UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT,
      description TEXT,
      visibility TEXT,
      url TEXT,
      slug TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arena_block_id INTEGER UNIQUE NOT NULL,
      title TEXT,
      description TEXT,
      block_type TEXT,
      source_url TEXT,
      source_provider_name TEXT,
      source_provider_url TEXT,
      image_url TEXT,
      image_thumb_url TEXT,
      image_display_url TEXT,
      image_original_url TEXT,
      content_text TEXT,
      content_html TEXT,
      search_text TEXT,
      arena_url TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE block_channels (
      block_id INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      position INTEGER,
      connected_at TEXT,
      PRIMARY KEY (block_id, channel_id),
      FOREIGN KEY (block_id) REFERENCES blocks(id),
      FOREIGN KEY (channel_id) REFERENCES channels(id)
    );
    CREATE TABLE sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      status TEXT,
      message TEXT,
      created_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE block_ocr (
      block_id INTEGER PRIMARY KEY,
      ocr_text TEXT,
      ocr_summary TEXT,
      ocr_model TEXT,
      ocr_processed_at TEXT,
      ocr_error TEXT,
      FOREIGN KEY (block_id) REFERENCES blocks(id)
    );
    CREATE TABLE block_link_content (
      block_id INTEGER PRIMARY KEY,
      url TEXT,
      content_text TEXT,
      content_chars INTEGER,
      extractor TEXT,
      fetched_at TEXT,
      error TEXT,
      FOREIGN KEY (block_id) REFERENCES blocks(id)
    );
    CREATE TABLE block_transcripts (
      block_id INTEGER PRIMARY KEY,
      transcript_text TEXT,
      source TEXT,
      language TEXT,
      fetched_at TEXT,
      error TEXT,
      FOREIGN KEY (block_id) REFERENCES blocks(id)
    );
  `);
  return db;
}

function channel(id: number, slug: string): ArenaChannel {
  return { id, slug, title: slug, base_type: "Channel" };
}

function block(id: number, position: number): ArenaBlock {
  return {
    id,
    type: "Text",
    base_type: "Block",
    title: `Block ${id}`,
    content: { plain: `Content ${id}` },
    position,
    connected_at: `2026-01-0${position}T00:00:00.000Z`,
  };
}

test("ingestUser upserts duplicate blocks once while linking every channel", async () => {
  const db = createIngestDb();
  try {
    const user: ArenaUser = { id: 1, slug: "profile", name: "Profile" };
    const channels = [channel(10, "first"), channel(20, "second")];
    const sharedInFirst = block(100, 1);
    const sharedInSecond = block(100, 2);
    const unique = block(200, 3);

    const result = await ingestUser("profile", {
      db,
      getUser: async () => user,
      getAllUserChannels: async () => channels,
      getAllChannelBlocks: async (slug) =>
        slug === "first" ? [sharedInFirst] : [sharedInSecond, unique],
    });

    assert.equal(result.channel_count, 2);
    assert.equal(result.link_count, 3);
    assert.deepEqual(result.failed_channels, []);

    const blockCount = db.prepare("SELECT COUNT(*) AS c FROM blocks").get() as {
      c: number;
    };
    const linkCount = db
      .prepare("SELECT COUNT(*) AS c FROM block_channels")
      .get() as { c: number };
    const sharedLinks = db
      .prepare(
        `SELECT COUNT(*) AS c
           FROM block_channels bc
           JOIN blocks b ON b.id = bc.block_id
          WHERE b.arena_block_id = 100`,
      )
      .get() as { c: number };

    assert.equal(blockCount.c, 2);
    assert.equal(linkCount.c, 3);
    assert.equal(sharedLinks.c, 2);
  } finally {
    db.close();
  }
});
