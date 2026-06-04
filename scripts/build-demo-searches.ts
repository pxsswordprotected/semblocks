// Owner-run generator for public, zero-cost demo searches/recommendations.
// Reads data/demo-queries.json, runs the real search/rec pipelines once, and
// stores the results in the demo_searches table. Public visitors then read
// these snapshots without triggering any OpenAI calls.
//
// Run with: npm run demos
// Requires .env.local for OPENAI_API_KEY (npm script wires --env-file).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runSearch } from "../lib/search-core.ts";
import { REC_K, REC_LIMIT, runChannelRec } from "../lib/recommend-core.ts";
import { captionImageForQuery } from "../lib/vision-query.ts";
import { upsertDemoSearch } from "../lib/demo-searches.ts";
import { DEFAULT_RESULT_LIMIT } from "../features/dashboard/blocks-table/resultLimit.ts";

type SearchEntry = { id: string; label: string; query: string };
type RecEntry = { id: string; label: string; query: string };
type ImageSearchEntry = { id: string; label: string; image_path: string };

type DemoConfig = {
  search?: SearchEntry[];
  rec?: RecEntry[];
  image_search?: ImageSearchEntry[];
};

const CONFIG = path.join(process.cwd(), "data", "demo-queries.json");

function mimeFromPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  throw new Error(`unsupported image extension: ${ext}`);
}

async function main(): Promise<void> {
  const raw = await readFile(CONFIG, "utf8");
  const config = JSON.parse(raw) as DemoConfig;

  let order = 0;
  let count = 0;

  for (const entry of config.search ?? []) {
    const hits = await runSearch(entry.query, DEFAULT_RESULT_LIMIT, null);
    upsertDemoSearch({
      id: entry.id,
      kind: "search",
      label: entry.label,
      query_text: entry.query,
      sort_order: order++,
      result: { query: entry.query, hits },
    });
    count += 1;
    console.log(`[demos] search "${entry.label}" → ${hits.length} hits`);
  }

  order = 0;
  for (const entry of config.image_search ?? []) {
    const buf = await readFile(path.resolve(process.cwd(), entry.image_path));
    const dataUrl = `data:${mimeFromPath(entry.image_path)};base64,${buf.toString("base64")}`;
    const { caption } = await captionImageForQuery(dataUrl);
    const hits = await runSearch(caption, DEFAULT_RESULT_LIMIT, null);
    upsertDemoSearch({
      id: entry.id,
      kind: "search",
      label: entry.label,
      query_text: caption,
      is_image: true,
      sort_order: 100 + order++,
      result: { query: caption, hits },
    });
    count += 1;
    console.log(`[demos] image search "${entry.label}" → ${hits.length} hits`);
  }

  order = 0;
  for (const entry of config.rec ?? []) {
    const result = await runChannelRec(entry.query, REC_K, REC_LIMIT);
    upsertDemoSearch({
      id: entry.id,
      kind: "rec",
      label: entry.label,
      query_text: entry.query,
      sort_order: order++,
      result,
    });
    count += 1;
    console.log(
      `[demos] rec "${entry.label}" → ${result.channels.length} channels`,
    );
  }

  console.log(`[demos] done: ${count} demos stored`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
