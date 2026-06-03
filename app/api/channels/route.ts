// List channels currently represented in the local DB along with the
// number of indexed blocks in each. Single-source-of-truth for the
// search UI's channel-filter panel — must reflect what's actually
// searchable (the DB), not the live Are.na profile (which may contain
// channels we haven't ingested yet).

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

type ChannelRow = {
  id: number;
  title: string | null;
  slug: string | null;
  url: string | null;
  block_count: number;
};

type TotalRow = {
  block_count: number;
};


export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.slug, c.url,
              COUNT(DISTINCT bc.block_id) AS block_count
         FROM channels c
         LEFT JOIN block_channels bc ON bc.channel_id = c.id
        GROUP BY c.id
        ORDER BY block_count DESC, lower(c.title)`,
    )
    .all() as ChannelRow[];
  const total = db
    .prepare(`SELECT COUNT(*) AS block_count FROM blocks`)
    .get() as TotalRow;

  return NextResponse.json({
    channels: rows,
    total_block_count: total.block_count,
  });
}
