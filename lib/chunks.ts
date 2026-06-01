import Database from "better-sqlite3";
import { getDb } from "./db.ts";
import { EMBEDDING_MODEL, embedMany } from "./embeddings.ts";
import {
  hashEmbeddingInput,
  isEmbeddingFresh,
} from "./embedding-freshness.ts";

export const LINK_CHUNK_MIN_CHARS = 8000;
export const LINK_CHUNK_MAX_CHARS = 3000;
export const LINK_CHUNK_OVERLAP_CHARS = 400;
export const EXTERNAL_CONTENT_CHUNK_TYPE = "external_content";
export const TRANSCRIPT_CHUNK_TYPE = "transcript";

const BATCH_SIZE = 100;

export type ChunkResult = {
  chunked: number;
  embedded: number;
  skipped: number;
  batches: number;
  cleared: number;
};

type Chunk = {
  chunk_index: number;
  text: string;
  source_start_char: number;
  source_end_char: number;
};

type CandidateChunk = {
  id: number;
  text: string;
  vector_chunk_id: number | null;
  input_hash: string | null;
  embedding_model: string | null;
};
type PendingChunk = { id: number; text: string; input_hash: string };
type LinkContentRow = { block_id: number; content_text: string };
type EmbedMany = (inputs: string[]) => Promise<Float32Array[]>;

type ChunkOptions = {
  minChars?: number;
  maxChars?: number;
  overlapChars?: number;
};

function findChunkEnd(text: string, start: number, hardEnd: number): number {
  if (hardEnd >= text.length) return text.length;

  const minEnd = start + Math.floor((hardEnd - start) * 0.6);

  const paragraph = text.lastIndexOf("\n\n", hardEnd - 2);
  if (paragraph >= minEnd) return paragraph + 2;

  for (let i = hardEnd - 1; i >= minEnd; i--) {
    const ch = text.charCodeAt(i);
    if (ch !== 46 && ch !== 33 && ch !== 63) continue; // . ! ?
    const next = text.charCodeAt(i + 1);
    if (next === 32 || next === 10 || next === 13 || Number.isNaN(next)) {
      return i + 1;
    }
  }

  for (let i = hardEnd - 1; i >= minEnd; i--) {
    const ch = text.charCodeAt(i);
    if (ch === 32 || ch === 10 || ch === 13 || ch === 9) return i + 1;
  }

  return hardEnd;
}

export function chunkText(
  text: string,
  opts: ChunkOptions = {},
): Chunk[] {
  const minChars = opts.minChars ?? LINK_CHUNK_MIN_CHARS;
  const maxChars = opts.maxChars ?? LINK_CHUNK_MAX_CHARS;
  const overlapChars = opts.overlapChars ?? LINK_CHUNK_OVERLAP_CHARS;

  if (text.length <= minChars) return [];
  if (maxChars <= 0) throw new Error("chunk maxChars must be positive");
  if (overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error("chunk overlapChars must be >= 0 and < maxChars");
  }

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + maxChars, text.length);
    const end = findChunkEnd(text, start, hardEnd);
    if (end <= start) throw new Error("chunker failed to advance");

    chunks.push({
      chunk_index: chunks.length,
      text: text.slice(start, end),
      source_start_char: start,
      source_end_char: end,
    });

    if (end >= text.length) break;
    const nextStart = Math.max(0, end - overlapChars);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

function deleteChunkEmbeddingsForBlock(
  db: Database.Database,
  blockId: number,
  chunkType: string,
): void {
  db.prepare(
    `DELETE FROM chunk_embedding_meta
      WHERE chunk_id IN (
        SELECT id FROM block_chunks
         WHERE block_id = ? AND chunk_type = ?
      )`,
  ).run(blockId, chunkType);
  db.prepare(
    `DELETE FROM vec_block_chunks
      WHERE chunk_id IN (
        SELECT id FROM block_chunks
         WHERE block_id = ? AND chunk_type = ?
      )`,
  ).run(blockId, chunkType);
}

export function clearChunksForBlock(
  db: Database.Database,
  blockId: number,
  chunkType: string,
): void {
  deleteChunkEmbeddingsForBlock(db, blockId, chunkType);
  db.prepare(
    `DELETE FROM block_chunks WHERE block_id = ? AND chunk_type = ?`,
  ).run(blockId, chunkType);
}


export function rebuildChunksForBlock(
  db: Database.Database,
  blockId: number,
  chunkType: string,
  text: string,
): number {
  const chunks = chunkText(text);
  clearChunksForBlock(db, blockId, chunkType);

  if (chunks.length === 0) return 0;

  const insert = db.prepare(`
    INSERT INTO block_chunks (
      block_id, chunk_type, chunk_index, text,
      source_start_char, source_end_char, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  for (const chunk of chunks) {
    insert.run(
      blockId,
      chunkType,
      chunk.chunk_index,
      chunk.text,
      chunk.source_start_char,
      chunk.source_end_char,
    );
  }
  return chunks.length;
}

function rebuildMissingLinkChunks(db: Database.Database): number {
  const rows = db
    .prepare(
      `SELECT c.block_id, c.content_text
         FROM block_link_content c
        WHERE c.content_text IS NOT NULL
          AND length(c.content_text) > ?
          AND NOT EXISTS (
            SELECT 1 FROM block_chunks bc
             WHERE bc.block_id = c.block_id
               AND bc.chunk_type = ?
          )
        ORDER BY c.block_id`,
    )
    .all(LINK_CHUNK_MIN_CHARS, EXTERNAL_CONTENT_CHUNK_TYPE) as LinkContentRow[];

  let chunked = 0;
  const tx = db.transaction((items: LinkContentRow[]) => {
    for (const row of items) {
      chunked += rebuildChunksForBlock(
        db,
        row.block_id,
        EXTERNAL_CONTENT_CHUNK_TYPE,
        row.content_text,
      );
    }
  });
  tx(rows);
  return chunked;
}

function rebuildAllLinkChunks(db: Database.Database): { chunked: number; cleared: number } {
  const existing = db
    .prepare(
      `SELECT COUNT(*) AS c FROM block_chunks WHERE chunk_type = ?`,
    )
    .get(EXTERNAL_CONTENT_CHUNK_TYPE) as { c: number };

  db.transaction(() => {
    db.prepare(
      `DELETE FROM chunk_embedding_meta
        WHERE chunk_id IN (
          SELECT id FROM block_chunks WHERE chunk_type = ?
        )`,
    ).run(EXTERNAL_CONTENT_CHUNK_TYPE);
    db.prepare(
      `DELETE FROM vec_block_chunks
        WHERE chunk_id IN (
          SELECT id FROM block_chunks WHERE chunk_type = ?
        )`,
    ).run(EXTERNAL_CONTENT_CHUNK_TYPE);
    db.prepare(`DELETE FROM block_chunks WHERE chunk_type = ?`).run(
      EXTERNAL_CONTENT_CHUNK_TYPE,
    );
  })();

  return { chunked: rebuildMissingLinkChunks(db), cleared: existing.c };
}

function rebuildMissingTranscriptChunks(db: Database.Database): number {
  const rows = db
    .prepare(
      `SELECT t.block_id, t.transcript_text AS content_text
         FROM block_transcripts t
        WHERE t.transcript_text IS NOT NULL
          AND length(t.transcript_text) > ?
          AND NOT EXISTS (
            SELECT 1 FROM block_chunks bc
             WHERE bc.block_id = t.block_id
               AND bc.chunk_type = ?
          )
        ORDER BY t.block_id`,
    )
    .all(LINK_CHUNK_MIN_CHARS, TRANSCRIPT_CHUNK_TYPE) as LinkContentRow[];

  let chunked = 0;
  const tx = db.transaction((items: LinkContentRow[]) => {
    for (const row of items) {
      chunked += rebuildChunksForBlock(
        db,
        row.block_id,
        TRANSCRIPT_CHUNK_TYPE,
        row.content_text,
      );
    }
  });
  tx(rows);
  return chunked;
}

function rebuildAllTranscriptChunks(
  db: Database.Database,
): { chunked: number; cleared: number } {
  const existing = db
    .prepare(
      `SELECT COUNT(*) AS c FROM block_chunks WHERE chunk_type = ?`,
    )
    .get(TRANSCRIPT_CHUNK_TYPE) as { c: number };

  db.transaction(() => {
    db.prepare(
      `DELETE FROM chunk_embedding_meta
        WHERE chunk_id IN (
          SELECT id FROM block_chunks WHERE chunk_type = ?
        )`,
    ).run(TRANSCRIPT_CHUNK_TYPE);
    db.prepare(
      `DELETE FROM vec_block_chunks
        WHERE chunk_id IN (
          SELECT id FROM block_chunks WHERE chunk_type = ?
        )`,
    ).run(TRANSCRIPT_CHUNK_TYPE);
    db.prepare(`DELETE FROM block_chunks WHERE chunk_type = ?`).run(
      TRANSCRIPT_CHUNK_TYPE,
    );
  })();

  return { chunked: rebuildMissingTranscriptChunks(db), cleared: existing.c };
}

export async function embedPendingChunks(
  db: Database.Database,
  opts: { embedMany?: EmbedMany; embeddingModel?: string } = {},
): Promise<{
  embedded: number;
  skipped: number;
  batches: number;
}> {
  const embedManyFn = opts.embedMany ?? embedMany;
  const embeddingModel = opts.embeddingModel ?? EMBEDDING_MODEL;
  const candidates = db
    .prepare(
      `SELECT c.id,
              c.text,
              v.chunk_id AS vector_chunk_id,
              m.input_hash,
              m.embedding_model
         FROM block_chunks c
         LEFT JOIN vec_block_chunks v ON v.chunk_id = c.id
         LEFT JOIN chunk_embedding_meta m ON m.chunk_id = c.id
        WHERE length(trim(c.text)) > 0
        ORDER BY c.id`,
    )
    .all() as CandidateChunk[];

  const pending: PendingChunk[] = [];
  for (const row of candidates) {
    const inputHash = hashEmbeddingInput(row.text);
    if (
      isEmbeddingFresh(
        {
          hasVector: row.vector_chunk_id !== null,
          input_hash: row.input_hash,
          embedding_model: row.embedding_model,
        },
        inputHash,
        embeddingModel,
      )
    ) {
      continue;
    }
    pending.push({ id: row.id, text: row.text, input_hash: inputHash });
  }

  if (pending.length === 0) return { embedded: 0, skipped: 0, batches: 0 };

  const deleteVector = db.prepare(`DELETE FROM vec_block_chunks WHERE chunk_id = ?`);
  const insertVector = db.prepare(
    `INSERT INTO vec_block_chunks (chunk_id, embedding, embedding_model, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  );
  const upsertMeta = db.prepare(
    `INSERT INTO chunk_embedding_meta (
       chunk_id, input_hash, embedding_model, embedded_at, input_chars
     ) VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(chunk_id) DO UPDATE SET
       input_hash = excluded.input_hash,
       embedding_model = excluded.embedding_model,
       embedded_at = excluded.embedded_at,
       input_chars = excluded.input_chars`,
  );
  const writeBatch = db.transaction(
    (rows: PendingChunk[], vectors: Float32Array[]) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const vector = vectors[i];
        deleteVector.run(row.id);
        insertVector.run(
          BigInt(row.id),
          Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
          embeddingModel,
        );
        upsertMeta.run(row.id, row.input_hash, embeddingModel, row.text.length);
      }
    },
  );

  let embedded = 0;
  let skipped = 0;
  let batches = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const slice = pending.slice(i, i + BATCH_SIZE);
    const vectors = await embedManyFn(slice.map((r) => r.text));
    if (vectors.length !== slice.length) {
      skipped += slice.length - vectors.length;
    }
    writeBatch(slice.slice(0, vectors.length), vectors);
    embedded += vectors.length;
    batches += 1;
  }

  return { embedded, skipped, batches };
}

export async function processChunks(
  opts: {
    rebuild?: boolean;
    db?: Database.Database;
    embedMany?: EmbedMany;
    embeddingModel?: string;
  } = {},
): Promise<ChunkResult> {
  const db = opts.db ?? getDb();
  const ext = opts.rebuild
    ? rebuildAllLinkChunks(db)
    : { chunked: rebuildMissingLinkChunks(db), cleared: 0 };
  const tx = opts.rebuild
    ? rebuildAllTranscriptChunks(db)
    : { chunked: rebuildMissingTranscriptChunks(db), cleared: 0 };
  const embedded = await embedPendingChunks(db, {
    embedMany: opts.embedMany,
    embeddingModel: opts.embeddingModel,
  });
  return {
    chunked: ext.chunked + tx.chunked,
    embedded: embedded.embedded,
    skipped: embedded.skipped,
    batches: embedded.batches,
    cleared: ext.cleared + tx.cleared,
  };
}
