import type Database from "better-sqlite3";
import { getDb } from "./db.ts";

export type ArenaProfileSummary = {
  username: string;
  url: string;
  name?: string | null;
  indexed_at?: string | null;
};

export type DashboardProfileConfig = {
  configured_profile: ArenaProfileSummary | null;
  indexed_profile: ArenaProfileSummary | null;
  display_profile: ArenaProfileSummary | null;
  sync_profile: ArenaProfileSummary | null;
};

type ProfileEnv = Record<string, string | undefined>;

export function profileUrl(username: string): string {
  return `https://www.are.na/${username}/channels`;
}

export function normalizeArenaProfileSlug(
  raw: string | null | undefined,
): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const slug = (
    /^https?:\/\//i.test(value) ? slugFromArenaUrl(value) : value
  )?.toLowerCase();

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  return slug;
}

export function getConfiguredArenaProfile(
  env: ProfileEnv = process.env,
): ArenaProfileSummary | null {
  const username = normalizeArenaProfileSlug(
    env.ARENA_PROFILE_SLUG ?? env.NEXT_PUBLIC_ARENA_PROFILE_SLUG,
  );
  return username ? { username, url: profileUrl(username) } : null;
}

export function getLatestIndexedArenaProfile(
  db: Database.Database = getDb(),
): ArenaProfileSummary | null {
  const row = db
    .prepare(
      `SELECT arena_username AS username,
              full_name AS name,
              indexed_at
         FROM users
     ORDER BY indexed_at DESC, id DESC
        LIMIT 1`,
    )
    .get() as
    | { username: string | null; name: string | null; indexed_at: string | null }
    | undefined;

  if (!row?.username) return null;
  return {
    username: row.username,
    url: profileUrl(row.username),
    name: row.name,
    indexed_at: row.indexed_at,
  };
}

export function getDashboardProfileConfig(
  opts: {
    env?: ProfileEnv;
    db?: Database.Database;
  } = {},
): DashboardProfileConfig {
  const configured = getConfiguredArenaProfile(opts.env ?? process.env);
  const indexed = getLatestIndexedArenaProfile(opts.db ?? getDb());

  return {
    configured_profile: configured,
    indexed_profile: indexed,
    display_profile: configured ?? indexed,
    sync_profile: configured ?? indexed,
  };
}

function slugFromArenaUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== "are.na" && host !== "www.are.na") return null;
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}
