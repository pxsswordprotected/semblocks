import { parseUserSlug } from "./arena.ts";
import { processChunks, type ChunkResult } from "./chunks.ts";
import { embedPendingBlocks, type EmbedResult } from "./embed-blocks.ts";
import {
  extractPendingExternalContent,
  type ExternalContentResult,
} from "./external-content.ts";
import { ingestUser, type IngestResult } from "./ingest.ts";
import { ocrPendingImages, type OcrResult } from "./ocr.ts";
import {
  extractPendingTranscripts,
  type TranscriptResult,
} from "./transcripts.ts";

export type FullSyncResult = {
  profile: { username: string };
  ingest: IngestResult;
  ocr: OcrResult;
  external_content: ExternalContentResult;
  transcripts: TranscriptResult;
  chunks: ChunkResult;
  embeddings: EmbedResult;
};

const FULL_SYNC_OCR_LIMIT = 500;

type StageOptions = { limit?: number; rebuild?: boolean };

export type FullSyncStages = {
  ingestUser?: (slug: string) => Promise<IngestResult>;
  ocrPendingImages?: (opts: StageOptions) => Promise<OcrResult>;
  extractPendingExternalContent?: (
    opts: StageOptions,
  ) => Promise<ExternalContentResult>;
  extractPendingTranscripts?: (
    opts: StageOptions,
  ) => Promise<TranscriptResult>;
  processChunks?: (opts: StageOptions) => Promise<ChunkResult>;
  embedPendingBlocks?: (opts: StageOptions) => Promise<EmbedResult>;
};

async function runLoggedStage<T>(
  name: string,
  run: () => Promise<T>,
  summarize: (result: T) => string,
): Promise<T> {
  const started = Date.now();
  console.log(`[sync] ${name} start`);
  try {
    const result = await run();
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[sync] ${name} done ${summarize(result)} elapsed=${elapsed}s`);
    return result;
  } catch (err) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync] ${name} failed elapsed=${elapsed}s error=${message}`);
    throw err;
  }
}

export async function runFullSync(opts: {
  user: string;
  stages?: FullSyncStages;
}): Promise<FullSyncResult> {
  const username = parseUserSlug(opts.user);
  const stages = opts.stages ?? {};

  console.log(`[sync] full sync start profile=${username}`);

  const ingest = await runLoggedStage(
    "ingest",
    () => (stages.ingestUser ?? ingestUser)(username),
    (r) =>
      `channels=${r.channel_count} blocks=${r.block_count} links=${r.link_count} failed_channels=${r.failed_channels.length}`,
  );
  const ocr = await runLoggedStage(
    "ocr",
    () =>
      (stages.ocrPendingImages ?? ocrPendingImages)({
        limit: FULL_SYNC_OCR_LIMIT,
        rebuild: false,
      }),
    (r) => `processed=${r.processed} errors=${r.errors} skipped=${r.skipped}`,
  );
  const externalContent = await runLoggedStage(
    "external-content",
    () =>
      (stages.extractPendingExternalContent ?? extractPendingExternalContent)({
        rebuild: false,
      }),
    (r) => `processed=${r.processed} errors=${r.errors} skipped=${r.skipped}`,
  );
  const transcripts = await runLoggedStage(
    "transcripts",
    () =>
      (stages.extractPendingTranscripts ?? extractPendingTranscripts)({
        rebuild: false,
      }),
    (r) => `processed=${r.processed} errors=${r.errors} skipped=${r.skipped}`,
  );
  const chunks = await runLoggedStage(
    "chunks",
    () => (stages.processChunks ?? processChunks)({ rebuild: false }),
    (r) =>
      `chunked=${r.chunked} embedded=${r.embedded} skipped=${r.skipped} batches=${r.batches}`,
  );
  const embeddings = await runLoggedStage(
    "embeddings",
    () => (stages.embedPendingBlocks ?? embedPendingBlocks)({ rebuild: false }),
    (r) =>
      `embedded=${r.embedded} skipped=${r.skipped} batches=${r.batches}`,
  );

  console.log(`[sync] full sync done profile=${username}`);

  return {
    profile: { username },
    ingest,
    ocr,
    external_content: externalContent,
    transcripts,
    chunks,
    embeddings,
  };
}
