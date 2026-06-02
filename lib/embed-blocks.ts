// Embed blocks whose stored vector is missing or stale for the exact input.

import type Database from "better-sqlite3";
import { getDb } from "./db.ts";
import { EMBEDDING_MODEL, embedMany } from "./embeddings.ts";
import {
  blockEmbeddingInput,
  hashEmbeddingInput,
  isEmbeddingFresh,
} from "./embedding-freshness.ts";

const BATCH_SIZE = 100;

export type EmbedResult = {
  embedded: number;
  skipped: number;
  batches: number;
  cleared: number;
};

type CandidateRow = {
  id: number;
  search_text: string;
  vector_block_id: number | null;
  input_hash: string | null;
  embedding_model: string | null;
};

type PendingRow = {
  id: number;
  input: string;
  input_hash: string;
};

type EmbedMany = (inputs: string[]) => Promise<Float32Array[]>;

export async function embedPendingBlocks(
  opts: {
    rebuild?: boolean;
    db?: Database.Database;
    embedMany?: EmbedMany;
    embeddingModel?: string;
  } = {},
): Promise<EmbedResult> {
  const db = opts.db ?? getDb();
  const embedManyFn = opts.embedMany ?? embedMany;
  const embeddingModel = opts.embeddingModel ?? EMBEDDING_MODEL;

  let cleared = 0;
  if (opts.rebuild) {
    cleared = (db.prepare("SELECT COUNT(*) AS c FROM vec_blocks").get() as {
      c: number;
    }).c;
    db.exec("DELETE FROM vec_blocks; DELETE FROM block_embedding_meta");
  }

  const candidates = db
    .prepare(
      `SELECT b.id,
              b.search_text,
              v.block_id AS vector_block_id,
              m.input_hash,
              m.embedding_model
         FROM blocks b
         LEFT JOIN vec_blocks v ON v.block_id = b.id
         LEFT JOIN block_embedding_meta m ON m.block_id = b.id
        WHERE b.search_text IS NOT NULL
          AND length(trim(b.search_text)) > 0
        ORDER BY b.id`,
    )
    .all() as CandidateRow[];

  const pending: PendingRow[] = [];
  for (const row of candidates) {
    const input = blockEmbeddingInput(row.search_text);
    const inputHash = hashEmbeddingInput(input);
    if (
      isEmbeddingFresh(
        {
          hasVector: row.vector_block_id !== null,
          input_hash: row.input_hash,
          embedding_model: row.embedding_model,
        },
        inputHash,
        embeddingModel,
      )
    ) {
      continue;
    }
    pending.push({ id: row.id, input, input_hash: inputHash });
  }

  if (pending.length === 0) {
    return { embedded: 0, skipped: 0, batches: 0, cleared };
  }

  console.log(`[sync:embeddings] start pending=${pending.length}`);

  const deleteVector = db.prepare(`DELETE FROM vec_blocks WHERE block_id = ?`);
  const insertVector = db.prepare(
    `INSERT INTO vec_blocks (block_id, embedding, embedding_model, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  );
  const upsertMeta = db.prepare(
    `INSERT INTO block_embedding_meta (
       block_id, input_hash, embedding_model, embedded_at, input_chars
     ) VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(block_id) DO UPDATE SET
       input_hash = excluded.input_hash,
       embedding_model = excluded.embedding_model,
       embedded_at = excluded.embedded_at,
       input_chars = excluded.input_chars`,
  );
  const writeBatch = db.transaction(
    (rows: PendingRow[], vectors: Float32Array[]) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const vector = vectors[i];
        deleteVector.run(row.id);
        insertVector.run(
          // sqlite-vec 0.1.9 rejects JS `number` for the vec0 PK column;
          // BigInt sidesteps the broken type check.
          BigInt(row.id),
          Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
          embeddingModel,
        );
        upsertMeta.run(row.id, row.input_hash, embeddingModel, row.input.length);
      }
    },
  );

  let embedded = 0;
  let batches = 0;
  let skipped = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const slice = pending.slice(i, i + BATCH_SIZE);
    const vectors = await embedManyFn(slice.map((r) => r.input));
    if (vectors.length !== slice.length) {
      // Defensive: openai sdk should return one embedding per input.
      skipped += slice.length - vectors.length;
    }
    writeBatch(slice.slice(0, vectors.length), vectors);
    embedded += vectors.length;
    batches += 1;
    console.log(
      `[sync:embeddings] progress ${Math.min(i + BATCH_SIZE, pending.length)}/${pending.length} embedded=${embedded} skipped=${skipped} batches=${batches}`,
    );
  }

  return { embedded, skipped, batches, cleared };
}
