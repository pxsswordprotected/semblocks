import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { embedPendingBlocks } from "./embed-blocks.ts";
import { blockEmbeddingInput, hashEmbeddingInput } from "./embedding-freshness.ts";

function createBlockEmbedDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_text TEXT
    );
    CREATE TABLE vec_blocks (
      block_id INTEGER PRIMARY KEY,
      embedding BLOB,
      embedding_model TEXT,
      created_at TEXT
    );
    CREATE TABLE block_embedding_meta (
      block_id INTEGER PRIMARY KEY,
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

function insertFreshBlock(db: Database.Database, id: number, text: string, model: string): void {
  db.prepare(`INSERT INTO blocks (id, search_text) VALUES (?, ?)`).run(id, text);
  db.prepare(
    `INSERT INTO vec_blocks (block_id, embedding, embedding_model, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  ).run(id, Buffer.from(vector(id).buffer), model);
  const input = blockEmbeddingInput(text);
  db.prepare(
    `INSERT INTO block_embedding_meta (block_id, input_hash, embedding_model, embedded_at, input_chars)
     VALUES (?, ?, ?, datetime('now'), ?)`,
  ).run(id, hashEmbeddingInput(input), model, input.length);
}

test("embedPendingBlocks skips blocks with matching vector metadata", async () => {
  const db = createBlockEmbedDb();
  try {
    insertFreshBlock(db, 1, "unchanged", "model-a");
    let calls = 0;

    const result = await embedPendingBlocks({
      db,
      embeddingModel: "model-a",
      embedMany: async () => {
        calls += 1;
        return [];
      },
    });

    assert.deepEqual(result, { embedded: 0, skipped: 0, batches: 0, cleared: 0 });
    assert.equal(calls, 0);
  } finally {
    db.close();
  }
});

test("embedPendingBlocks re-embeds when block search text changes", async () => {
  const db = createBlockEmbedDb();
  try {
    db.prepare(`INSERT INTO blocks (id, search_text) VALUES (1, 'new text')`).run();
    db.prepare(
      `INSERT INTO vec_blocks (block_id, embedding, embedding_model, created_at)
       VALUES (1, ?, 'model-a', datetime('now'))`,
    ).run(Buffer.from(vector(1).buffer));
    db.prepare(
      `INSERT INTO block_embedding_meta (block_id, input_hash, embedding_model, embedded_at, input_chars)
       VALUES (1, ?, 'model-a', datetime('now'), ?)`,
    ).run(hashEmbeddingInput(blockEmbeddingInput("old text")), "old text".length);

    const seenInputs: string[] = [];
    const result = await embedPendingBlocks({
      db,
      embeddingModel: "model-a",
      embedMany: async (inputs) => {
        seenInputs.push(...inputs);
        return inputs.map((_, i) => vector(i + 10));
      },
    });

    assert.deepEqual(result, { embedded: 1, skipped: 0, batches: 1, cleared: 0 });
    assert.deepEqual(seenInputs, ["new text"]);
    const meta = db
      .prepare(`SELECT input_hash, embedding_model, input_chars FROM block_embedding_meta WHERE block_id = 1`)
      .get() as { input_hash: string; embedding_model: string; input_chars: number };
    assert.equal(meta.input_hash, hashEmbeddingInput("new text"));
    assert.equal(meta.embedding_model, "model-a");
    assert.equal(meta.input_chars, "new text".length);
  } finally {
    db.close();
  }
});

test("embedPendingBlocks re-embeds when metadata is missing or model differs", async () => {
  const db = createBlockEmbedDb();
  try {
    insertFreshBlock(db, 1, "wrong model", "model-old");
    db.prepare(`INSERT INTO blocks (id, search_text) VALUES (2, 'missing meta')`).run();
    db.prepare(
      `INSERT INTO vec_blocks (block_id, embedding, embedding_model, created_at)
       VALUES (2, ?, 'model-a', datetime('now'))`,
    ).run(Buffer.from(vector(2).buffer));

    const seenInputs: string[] = [];
    const result = await embedPendingBlocks({
      db,
      embeddingModel: "model-a",
      embedMany: async (inputs) => {
        seenInputs.push(...inputs);
        return inputs.map((_, i) => vector(i + 20));
      },
    });

    assert.deepEqual(result, { embedded: 2, skipped: 0, batches: 1, cleared: 0 });
    assert.deepEqual(seenInputs, ["wrong model", "missing meta"]);
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM block_embedding_meta`).get() as { c: number }).c, 2);
  } finally {
    db.close();
  }
});

test("embedPendingBlocks rebuild clears vector metadata before embedding", async () => {
  const db = createBlockEmbedDb();
  try {
    insertFreshBlock(db, 1, "unchanged", "model-a");

    const result = await embedPendingBlocks({
      db,
      rebuild: true,
      embeddingModel: "model-a",
      embedMany: async (inputs) => inputs.map((_, i) => vector(i + 30)),
    });

    assert.deepEqual(result, { embedded: 1, skipped: 0, batches: 1, cleared: 1 });
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM vec_blocks`).get() as { c: number }).c, 1);
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM block_embedding_meta`).get() as { c: number }).c, 1);
  } finally {
    db.close();
  }
});

test("block embedding metadata rejects negative input length", () => {
  const db = createBlockEmbedDb();
  try {
    assert.throws(() => {
      db.prepare(
        `INSERT INTO block_embedding_meta (
          block_id, input_hash, embedding_model, embedded_at, input_chars
        ) VALUES (1, 'hash', 'model', datetime('now'), -1)`,
      ).run();
    }, /CHECK constraint failed/);
  } finally {
    db.close();
  }
});
