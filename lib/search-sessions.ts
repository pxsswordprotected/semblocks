import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db.ts";

const SESSION_ID_BYTES = 16;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ROWS = 5_000;
export const MAX_SEARCH_SESSION_QUERY_CHARS = 50_000;
export const SEARCH_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

type Db = Database.Database;

type SearchSessionRow = {
  id: string;
  query_text: string;
  query_hash: string;
  query_len: number;
  created_at: string;
  last_used_at: string;
  expires_at: string;
};

export type SearchSession = {
  id: string;
  query_text: string;
  query_hash: string;
  query_len: number;
  created_at: string;
  last_used_at: string;
  expires_at: string;
};

export type CreateSearchSessionResult = SearchSession & {
  reused: boolean;
};

export class SearchSessionInputError extends Error {
  readonly status = 400;
}

export class SearchSessionNotFoundError extends Error {
  readonly status = 404;

  constructor() {
    super("Search session not found");
  }
}

function dbOrDefault(db?: Db): Db {
  return db ?? getDb();
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiresAtFrom(now: Date): string {
  return new Date(now.getTime() + SESSION_TTL_MS).toISOString();
}

function toSession(row: SearchSessionRow): SearchSession {
  return { ...row };
}

export function normalizeSearchQuery(q: string): string {
  return q.trim();
}

export function hashSearchQuery(q: string): string {
  return createHash("sha256").update(q).digest("hex");
}

function createSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString("base64url");
}

function validateQuery(q: string): string {
  const query = normalizeSearchQuery(q);
  if (!query) throw new SearchSessionInputError("Search query is required");
  if (query.length > MAX_SEARCH_SESSION_QUERY_CHARS) {
    throw new SearchSessionInputError("Search query is too large");
  }
  return query;
}

function validateSessionId(id: string): boolean {
  return SEARCH_SESSION_ID_PATTERN.test(id);
}

export function cleanupSearchSessions(
  opts: { db?: Db; maxRows?: number; now?: Date } = {},
): void {
  const db = dbOrDefault(opts.db);
  const now = (opts.now ?? new Date()).toISOString();
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;

  db.prepare(`DELETE FROM search_sessions WHERE expires_at <= ?`).run(now);

  if (maxRows <= 0) {
    db.prepare(`DELETE FROM search_sessions`).run();
    return;
  }

  db.prepare(
    `DELETE FROM search_sessions
      WHERE id IN (
        SELECT id
          FROM search_sessions
         ORDER BY last_used_at DESC, created_at DESC
         LIMIT -1 OFFSET ?
      )`,
  ).run(maxRows);
}

export function createOrReuseSearchSession(
  q: string,
  opts: { db?: Db; now?: Date } = {},
): CreateSearchSessionResult {
  const db = dbOrDefault(opts.db);
  const now = opts.now ?? new Date();
  const ts = now.toISOString();
  const query = validateQuery(q);
  const queryHash = hashSearchQuery(query);

  cleanupSearchSessions({ db, now });

  const existing = db
    .prepare(
      `SELECT * FROM search_sessions
        WHERE query_hash = ? AND query_text = ? AND expires_at > ?
        ORDER BY last_used_at DESC
        LIMIT 1`,
    )
    .get(queryHash, query, ts) as SearchSessionRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE search_sessions
          SET last_used_at = ?
        WHERE id = ?`,
    ).run(ts, existing.id);
    return { ...toSession({ ...existing, last_used_at: ts }), reused: true };
  }

  const row: SearchSessionRow = {
    id: createSessionId(),
    query_text: query,
    query_hash: queryHash,
    query_len: query.length,
    created_at: ts,
    last_used_at: ts,
    expires_at: expiresAtFrom(now),
  };

  db.prepare(
    `INSERT INTO search_sessions (
       id, query_text, query_hash, query_len, created_at, last_used_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.query_text,
    row.query_hash,
    row.query_len,
    row.created_at,
    row.last_used_at,
    row.expires_at,
  );

  return { ...toSession(row), reused: false };
}

export function getSearchSession(
  id: string,
  opts: { db?: Db; now?: Date } = {},
): SearchSession | null {
  if (!validateSessionId(id)) return null;

  const db = dbOrDefault(opts.db);
  const ts = (opts.now ?? new Date()).toISOString();
  const row = db
    .prepare(`SELECT * FROM search_sessions WHERE id = ? AND expires_at > ?`)
    .get(id, ts) as SearchSessionRow | undefined;

  if (!row) return null;

  db.prepare(
    `UPDATE search_sessions
        SET last_used_at = ?
      WHERE id = ?`,
  ).run(ts, id);

  return toSession({ ...row, last_used_at: ts });
}

export function resolveSearchQuery({
  q,
  sid,
  db,
}: {
  q: string | null;
  sid: string | null;
  db?: Db;
}): string {
  const normalizedSid = sid?.trim() ?? "";
  if (normalizedSid) {
    const session = getSearchSession(normalizedSid, { db });
    if (!session) throw new SearchSessionNotFoundError();
    return session.query_text;
  }

  return normalizeSearchQuery(q ?? "");
}
