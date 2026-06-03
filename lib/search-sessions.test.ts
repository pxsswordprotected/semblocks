import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  MAX_SEARCH_SESSION_QUERY_CHARS,
  SearchSessionInputError,
  SearchSessionNotFoundError,
  cleanupSearchSessions,
  createOrReuseSearchSession,
  getSearchSession,
  normalizeSearchQuery,
  resolveSearchQuery,
} from "./search-sessions.ts";

function createSessionsDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
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
  `);
  return db;
}

test("normalizeSearchQuery trims without rewriting internal text", () => {
  assert.equal(normalizeSearchQuery("  hello   world  "), "hello   world");
});

test("createOrReuseSearchSession rejects empty and huge queries", () => {
  const db = createSessionsDb();
  try {
    assert.throws(
      () => createOrReuseSearchSession("   ", { db }),
      SearchSessionInputError,
    );
    assert.throws(
      () => createOrReuseSearchSession("x".repeat(MAX_SEARCH_SESSION_QUERY_CHARS + 1), { db }),
      SearchSessionInputError,
    );
  } finally {
    db.close();
  }
});

test("createOrReuseSearchSession stores long query and reuses exact normalized query", () => {
  const db = createSessionsDb();
  try {
    const query = `${"Merleau-Ponty ".repeat(40)}language and embodiment`;
    const first = createOrReuseSearchSession(`  ${query}  `, { db });
    const second = createOrReuseSearchSession(query, { db });

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.id, first.id);
    assert.equal(first.query_text, query);
    assert.equal(first.query_len, query.length);
    assert.match(first.id, /^[A-Za-z0-9_-]{8,64}$/);

    const rows = db.prepare(`SELECT COUNT(*) AS c FROM search_sessions`).get() as {
      c: number;
    };
    assert.equal(rows.c, 1);
  } finally {
    db.close();
  }
});

test("getSearchSession returns null for invalid, missing, and expired sessions", () => {
  const db = createSessionsDb();
  try {
    assert.equal(getSearchSession("not valid!", { db }), null);
    assert.equal(getSearchSession("missing_id", { db }), null);

    const expiredNow = new Date("2026-01-01T00:00:00.000Z");
    const session = createOrReuseSearchSession("expired query", {
      db,
      now: expiredNow,
    });
    assert.equal(
      getSearchSession(session.id, {
        db,
        now: new Date("2026-02-15T00:00:00.000Z"),
      }),
      null,
    );
  } finally {
    db.close();
  }
});

test("resolveSearchQuery prefers sid, trims q, and throws for expired sid", () => {
  const db = createSessionsDb();
  try {
    const session = createOrReuseSearchSession("stored query", { db });
    assert.equal(
      resolveSearchQuery({ q: "ignored", sid: session.id, db }),
      "stored query",
    );
    assert.equal(resolveSearchQuery({ q: "  direct query  ", sid: null, db }), "direct query");
    assert.throws(
      () => resolveSearchQuery({ q: "fallback", sid: "missing_id", db }),
      SearchSessionNotFoundError,
    );
  } finally {
    db.close();
  }
});

test("cleanupSearchSessions deletes expired rows and caps oldest rows", () => {
  const db = createSessionsDb();
  try {
    const base = new Date("2026-01-01T00:00:00.000Z");
    const old = createOrReuseSearchSession("old", { db, now: base });
    const newest = createOrReuseSearchSession("newest", {
      db,
      now: new Date("2026-01-03T00:00:00.000Z"),
    });
    const middle = createOrReuseSearchSession("middle", {
      db,
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    cleanupSearchSessions({
      db,
      maxRows: 2,
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
    const checkNow = new Date("2026-01-04T00:00:01.000Z");


    assert.equal(getSearchSession(old.id, { db, now: checkNow }), null);
    assert.ok(getSearchSession(newest.id, { db, now: checkNow }));
    assert.ok(getSearchSession(middle.id, { db, now: checkNow }));

    const expired = createOrReuseSearchSession("will expire", {
      db,
      now: base,
    });
    cleanupSearchSessions({
      db,
      maxRows: 10,
      now: new Date("2026-02-15T00:00:00.000Z"),
    });
    assert.equal(getSearchSession(expired.id, { db }), null);
  } finally {
    db.close();
  }
});
