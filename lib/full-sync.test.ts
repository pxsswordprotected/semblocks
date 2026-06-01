import { test } from "node:test";
import assert from "node:assert/strict";

import { runFullSync, type FullSyncStages } from "./full-sync.ts";

function assertNonRebuild(opts: { rebuild?: boolean }) {
  assert.equal(opts.rebuild, false);
}

test("runFullSync executes non-destructive stages in order", async () => {
  const calls: string[] = [];
  const stages: FullSyncStages = {
    ingestUser: async (slug) => {
      calls.push(`ingest:${slug}`);
      return {
        user_id: 1,
        channel_count: 2,
        block_count: 3,
        link_count: 4,
        failed_channels: [],
      };
    },
    ocrPendingImages: async (opts) => {
      assertNonRebuild(opts);
      calls.push("ocr");
      return { processed: 5, errors: 1, skipped: 0, cleared: 0 };
    },
    extractPendingExternalContent: async (opts) => {
      assertNonRebuild(opts);
      calls.push("external");
      return { processed: 6, errors: 2, skipped: 1, cleared: 0 };
    },
    extractPendingTranscripts: async (opts) => {
      assertNonRebuild(opts);
      calls.push("transcripts");
      return { processed: 7, errors: 3, skipped: 2, cleared: 0 };
    },
    processChunks: async (opts) => {
      assertNonRebuild(opts);
      calls.push("chunks");
      return { chunked: 8, embedded: 9, skipped: 4, batches: 1, cleared: 0 };
    },
    embedPendingBlocks: async (opts) => {
      assertNonRebuild(opts);
      calls.push("embeddings");
      return { embedded: 10, skipped: 5, batches: 2, cleared: 0 };
    },
  };

  const result = await runFullSync({
    user: "https://www.are.na/Example-Profile/channels",
    stages,
  });

  assert.deepEqual(calls, [
    "ingest:example-profile",
    "ocr",
    "external",
    "transcripts",
    "chunks",
    "embeddings",
  ]);
  assert.deepEqual(result, {
    profile: { username: "example-profile" },
    ingest: {
      user_id: 1,
      channel_count: 2,
      block_count: 3,
      link_count: 4,
      failed_channels: [],
    },
    ocr: { processed: 5, errors: 1, skipped: 0, cleared: 0 },
    external_content: { processed: 6, errors: 2, skipped: 1, cleared: 0 },
    transcripts: { processed: 7, errors: 3, skipped: 2, cleared: 0 },
    chunks: { chunked: 8, embedded: 9, skipped: 4, batches: 1, cleared: 0 },
    embeddings: { embedded: 10, skipped: 5, batches: 2, cleared: 0 },
  });
});
