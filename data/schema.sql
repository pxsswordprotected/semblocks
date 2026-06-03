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
  FOREIGN KEY (channel_id) REFERENCES channels(id) --eg the foreign key rule makes sure 10 really exists in blocks and 3 really exists in channels, so your database does not contain fake or broken links.
);

CREATE VIRTUAL TABLE vec_blocks USING vec0(
block_id INTEGER PRIMARY KEY,
embedding float[1536], --a fixed length array of 1536 32-bit floats
+embedding_model TEXT,
+created_at TEXT
);
CREATE TABLE block_embedding_meta (
    block_id INTEGER PRIMARY KEY,
    input_hash TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    embedded_at TEXT NOT NULL,
    input_chars INTEGER NOT NULL CHECK (input_chars >= 0),
    FOREIGN KEY (block_id) REFERENCES blocks(id)
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

-- block_link_content stores extracted external content for Link AND Attachment
-- blocks (PDFs, etc.). Table name predates Attachment support; kept as-is to
-- avoid a costly data migration. See lib/external-content.ts.
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

-- block_transcripts stores YouTube subtitles extracted via yt-dlp for any
-- block whose source_url points at a YouTube host (Embed and the rare Text
-- outlier). See lib/transcripts.ts.
CREATE TABLE block_transcripts (
    block_id INTEGER PRIMARY KEY,
    transcript_text TEXT,
    source TEXT,
    language TEXT,
    fetched_at TEXT,
    error TEXT,
    FOREIGN KEY (block_id) REFERENCES blocks(id)
);

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

CREATE VIRTUAL TABLE vec_block_chunks USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding float[1536],
    +embedding_model TEXT,
    +created_at TEXT
);
CREATE TABLE chunk_embedding_meta (
    chunk_id INTEGER PRIMARY KEY,
    input_hash TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    embedded_at TEXT NOT NULL,
    input_chars INTEGER NOT NULL CHECK (input_chars >= 0),
    FOREIGN KEY (chunk_id) REFERENCES block_chunks(id)
);

CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
    progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= 0),
    message TEXT,
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    updated_at TEXT NOT NULL,
    finished_at TEXT,
    cancel_requested_at TEXT,
    dedupe_key TEXT,
    worker_id TEXT
);

CREATE UNIQUE INDEX jobs_dedupe_active
ON jobs(dedupe_key)
WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

CREATE TABLE job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    event_type TEXT NOT NULL,
    message TEXT,
    data_json TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE search_sessions (
    id TEXT PRIMARY KEY,
    query_text TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    query_len INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX search_sessions_query_hash_idx
ON search_sessions(query_hash);

CREATE INDEX search_sessions_expires_at_idx
ON search_sessions(expires_at);

CREATE INDEX search_sessions_last_used_at_idx
ON search_sessions(last_used_at);


