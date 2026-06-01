import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { clearChunksForBlock, embedPendingChunks } from "./chunks.ts";
import { hashEmbeddingInput } from "./embedding-freshness.ts";

function createChunkEmbedDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE block_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id INTEGER NOT NULL,
      chunk_type TEXT NOT NULL,
      chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
      text TEXT NOT NULL,
      source_start_char INTEGER NOT NULL CHECK (source_start_char >= 0),
      source_end_char INTEGER NOT NULL CHECK (source_end_char >= source_start_char)
    );
    CREATE TABLE vec_block_chunks (
      chunk_id INTEGER PRIMARY KEY,
      embedding BLOB,
      embedding_model TEXT,
      created_at TEXT
    );
    CREATE TABLE chunk_embedding_meta (
      chunk_id INTEGER PRIMARY KEY,
      input_hash TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedded_at TEXT NOT NULL,
      input_chars INTEGER NOT NULL CHECK (input_chars >= 0)
    );
  `);
  return db;
}

function vector(value: number): Float32Array {
  return new Float32Array([value, value + 1]);
}

function insertChunk(db: Database.Database, id: number, text: string): void {
  db.prepare(
    `INSERT INTO block_chunks (id, block_id, chunk_type, chunk_index, text, source_start_char, source_end_char)
     VALUES (?, 1, 'external_content', ?, ?, 0, ?)`,
  ).run(id, id, text, text.length);
}

function insertFreshChunk(db: Database.Database, id: number, text: string, model: string): void {
  insertChunk(db, id, text);
  db.prepare(
    `INSERT INTO vec_block_chunks (chunk_id, embedding, embedding_model, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  ).run(id, Buffer.from(vector(id).buffer), model);
  db.prepare(
    `INSERT INTO chunk_embedding_meta (chunk_id, input_hash, embedding_model, embedded_at, input_chars)
     VALUES (?, ?, ?, datetime('now'), ?)`,
  ).run(id, hashEmbeddingInput(text), model, text.length);
}

test("embedPendingChunks skips chunks with matching vector metadata", async () => {
  const db = createChunkEmbedDb();
  try {
    insertFreshChunk(db, 1, "unchanged chunk", "model-a");
    let calls = 0;

    const result = await embedPendingChunks(db, {
      embeddingModel: "model-a",
      embedMany: async () => {
        calls += 1;
        return [];
      },
    });

    assert.deepEqual(result, { embedded: 0, skipped: 0, batches: 0 });
    assert.equal(calls, 0);
  } finally {
    db.close();
  }
});

test("embedPendingChunks re-embeds changed text, missing metadata, and model changes", async () => {
  const db = createChunkEmbedDb();
  try {
    insertChunk(db, 1, "changed chunk");
    db.prepare(
      `INSERT INTO vec_block_chunks (chunk_id, embedding, embedding_model, created_at)
       VALUES (1, ?, 'model-a', datetime('now'))`,
    ).run(Buffer.from(vector(1).buffer));
    db.prepare(
      `INSERT INTO chunk_embedding_meta (chunk_id, input_hash, embedding_model, embedded_at, input_chars)
       VALUES (1, ?, 'model-a', datetime('now'), ?)`,
    ).run(hashEmbeddingInput("old chunk"), "old chunk".length);
    insertFreshChunk(db, 2, "wrong model", "model-old");
    insertChunk(db, 3, "missing meta");
    db.prepare(
      `INSERT INTO vec_block_chunks (chunk_id, embedding, embedding_model, created_at)
       VALUES (3, ?, 'model-a', datetime('now'))`,
    ).run(Buffer.from(vector(3).buffer));

    const seenInputs: string[] = [];
    const result = await embedPendingChunks(db, {
      embeddingModel: "model-a",
      embedMany: async (inputs) => {
        seenInputs.push(...inputs);
        return inputs.map((_, i) => vector(i + 10));
      },
    });

    assert.deepEqual(result, { embedded: 3, skipped: 0, batches: 1 });
    assert.deepEqual(seenInputs, ["changed chunk", "wrong model", "missing meta"]);
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM chunk_embedding_meta`).get() as { c: number }).c, 3);
    const meta = db
      .prepare(`SELECT input_hash, embedding_model, input_chars FROM chunk_embedding_meta WHERE chunk_id = 1`)
      .get() as { input_hash: string; embedding_model: string; input_chars: number };
    assert.equal(meta.input_hash, hashEmbeddingInput("changed chunk"));
    assert.equal(meta.embedding_model, "model-a");
    assert.equal(meta.input_chars, "changed chunk".length);
  } finally {
    db.close();
  }
});

test("clearChunksForBlock deletes chunk vectors and metadata before chunk rows", () => {
  const db = createChunkEmbedDb();
  try {
    insertFreshChunk(db, 1, "first", "model-a");
    insertFreshChunk(db, 2, "second", "model-a");
    db.prepare(`UPDATE block_chunks SET block_id = 2 WHERE id = 2`).run();

    clearChunksForBlock(db, 1, "external_content");

    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM block_chunks`).get() as { c: number }).c, 1);
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM vec_block_chunks`).get() as { c: number }).c, 1);
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM chunk_embedding_meta`).get() as { c: number }).c, 1);
    assert.equal(
      (db.prepare(`SELECT id FROM block_chunks`).get() as { id: number }).id,
      2,
    );
  } finally {
    db.close();
  }
});

test("chunk tables reject negative and inverted metadata", () => {
  const db = createChunkEmbedDb();
  try {
    assert.throws(() => {
      db.prepare(
        `INSERT INTO block_chunks (
          block_id, chunk_type, chunk_index, text, source_start_char, source_end_char
        ) VALUES (1, 'external_content', -1, 'text', 0, 4)`,
      ).run();
    }, /CHECK constraint failed/);
    assert.throws(() => {
      db.prepare(
        `INSERT INTO block_chunks (
          block_id, chunk_type, chunk_index, text, source_start_char, source_end_char
        ) VALUES (1, 'external_content', 0, 'text', -1, 4)`,
      ).run();
    }, /CHECK constraint failed/);
    assert.throws(() => {
      db.prepare(
        `INSERT INTO block_chunks (
          block_id, chunk_type, chunk_index, text, source_start_char, source_end_char
        ) VALUES (1, 'external_content', 0, 'text', 5, 4)`,
      ).run();
    }, /CHECK constraint failed/);
    assert.throws(() => {
      db.prepare(
        `INSERT INTO chunk_embedding_meta (
          chunk_id, input_hash, embedding_model, embedded_at, input_chars
        ) VALUES (1, 'hash', 'model', datetime('now'), -1)`,
      ).run();
    }, /CHECK constraint failed/);
  } finally {
    db.close();
  }
});
