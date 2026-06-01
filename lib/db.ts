import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "node:fs";
import path from "node:path";

export const EMBEDDING_DIM = 1536; // text-embedding-3-small

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const file =
    process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "aresearch.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);

  // The canonical schema in `data/schema.sql` doesn't use `IF NOT EXISTS`,
  // so we only apply the full file on a fresh DB (no `users` table yet).
  // For already-initialized DBs we apply targeted migrations table-by-table.
  const hasTable = (name: string) =>
    Boolean(
      db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(name),
    );
  const tableSql = (name: string): string | null =>
    (
      db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(name) as { sql: string } | undefined
    )?.sql ?? null;

  const assertForeignKeyCheck = () => {
    const violations = db.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) {
      throw new Error("SQLite foreign key check failed after migration");
    }
  };

  const migrateBlockChunksChecks = () => {
    const sql = tableSql("block_chunks");
    if (
      !sql ||
      (sql.includes("CHECK (chunk_index >= 0)") &&
        sql.includes("CHECK (source_start_char >= 0)") &&
        sql.includes("CHECK (source_end_char >= source_start_char)"))
    ) {
      return;
    }

    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE block_chunks_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            block_id INTEGER NOT NULL,
            chunk_type TEXT NOT NULL,
            chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
            text TEXT NOT NULL,
            source_start_char INTEGER NOT NULL CHECK (source_start_char >= 0),
            source_end_char INTEGER NOT NULL CHECK (source_end_char >= source_start_char),
            created_at TEXT,
            FOREIGN KEY (block_id) REFERENCES blocks(id),
            UNIQUE(block_id, chunk_type, chunk_index)
        );
        INSERT INTO block_chunks_new (
            id, block_id, chunk_type, chunk_index, text,
            source_start_char, source_end_char, created_at
        )
        SELECT id, block_id, chunk_type, chunk_index, text,
               source_start_char, source_end_char, created_at
          FROM block_chunks;
        DROP TABLE block_chunks;
        ALTER TABLE block_chunks_new RENAME TO block_chunks;
      `);
    });

    db.pragma("foreign_keys = OFF");
    try {
      tx();
    } finally {
      db.pragma("foreign_keys = ON");
    }
    assertForeignKeyCheck();
  };

  const migrateEmbeddingMetaChecks = (
    tableName: "block_embedding_meta" | "chunk_embedding_meta",
    keyColumn: "block_id" | "chunk_id",
    foreignTable: "blocks" | "block_chunks",
  ) => {
    const sql = tableSql(tableName);
    if (!sql || sql.includes("CHECK (input_chars >= 0)")) return;

    const nextTable = `${tableName}_new`;
    const tx = db.transaction(() => {
      db.exec(`
        CREATE TABLE ${nextTable} (
            ${keyColumn} INTEGER PRIMARY KEY,
            input_hash TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            embedded_at TEXT NOT NULL,
            input_chars INTEGER NOT NULL CHECK (input_chars >= 0),
            FOREIGN KEY (${keyColumn}) REFERENCES ${foreignTable}(id)
        );
        INSERT INTO ${nextTable} (
            ${keyColumn}, input_hash, embedding_model, embedded_at, input_chars
        )
        SELECT ${keyColumn}, input_hash, embedding_model, embedded_at, input_chars
          FROM ${tableName};
        DROP TABLE ${tableName};
        ALTER TABLE ${nextTable} RENAME TO ${tableName};
      `);
    });

    db.pragma("foreign_keys = OFF");
    try {
      tx();
    } finally {
      db.pragma("foreign_keys = ON");
    }
    assertForeignKeyCheck();
  };

  if (!hasTable("users")) {
    const schemaPath = path.join(process.cwd(), "data", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");
    db.exec(schema);
  } else {
    // Targeted migration: add tables introduced after the initial schema.
    if (!hasTable("block_ocr")) {
      db.exec(`
        CREATE TABLE block_ocr (
            block_id INTEGER PRIMARY KEY,
            ocr_text TEXT,
            ocr_summary TEXT,
            ocr_model TEXT,
            ocr_processed_at TEXT,
            ocr_error TEXT,
            FOREIGN KEY (block_id) REFERENCES blocks(id)
        );
      `);
    }
    if (!hasTable("block_link_content")) {
      // block_link_content stores extracted external content for Link AND
      // Attachment blocks (PDFs, etc.). Table name predates Attachment
      // support; kept as-is to avoid a costly data migration. See
      // lib/external-content.ts.
      db.exec(`
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
      `);
    }
    if (!hasTable("block_transcripts")) {
      // block_transcripts stores YouTube subtitles extracted via yt-dlp.
      // See lib/transcripts.ts.
      db.exec(`
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
    }
    if (!hasTable("block_chunks")) {
      db.exec(`
        CREATE TABLE block_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            block_id INTEGER NOT NULL,
            chunk_type TEXT NOT NULL,
            chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
            text TEXT NOT NULL,
            source_start_char INTEGER NOT NULL CHECK (source_start_char >= 0),
            source_end_char INTEGER NOT NULL CHECK (source_end_char >= source_start_char),
            created_at TEXT,
            FOREIGN KEY (block_id) REFERENCES blocks(id),
            UNIQUE(block_id, chunk_type, chunk_index)
        );
      `);
    }
    if (!hasTable("vec_block_chunks")) {
      db.exec(`
        CREATE VIRTUAL TABLE vec_block_chunks USING vec0(
            chunk_id INTEGER PRIMARY KEY,
            embedding float[1536],
            +embedding_model TEXT,
            +created_at TEXT
        );
      `);
    }

    if (!hasTable("block_embedding_meta")) {
      db.exec(`
        CREATE TABLE block_embedding_meta (
            block_id INTEGER PRIMARY KEY,
            input_hash TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            embedded_at TEXT NOT NULL,
            input_chars INTEGER NOT NULL CHECK (input_chars >= 0),
            FOREIGN KEY (block_id) REFERENCES blocks(id)
        );
      `);
    }
    if (!hasTable("chunk_embedding_meta")) {
      db.exec(`
        CREATE TABLE chunk_embedding_meta (
            chunk_id INTEGER PRIMARY KEY,
            input_hash TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            embedded_at TEXT NOT NULL,
            input_chars INTEGER NOT NULL CHECK (input_chars >= 0),
            FOREIGN KEY (chunk_id) REFERENCES block_chunks(id)
        );
      `);
    }

    migrateBlockChunksChecks();
    migrateEmbeddingMetaChecks("block_embedding_meta", "block_id", "blocks");
    migrateEmbeddingMetaChecks("chunk_embedding_meta", "chunk_id", "block_chunks");

    // One-time chunk_type tag rename: link_content → external_content.
    // Idempotent — re-running is a no-op once the rows are renamed.
    if (hasTable("block_chunks")) {
      db.prepare(
        `UPDATE block_chunks
            SET chunk_type = 'external_content'
          WHERE chunk_type = 'link_content'`,
      ).run();
    }
  }

  _db = db;
  return db;
}
