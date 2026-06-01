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

type RebuildOnlyOptions = { rebuild?: boolean };

export type FullSyncStages = {
  ingestUser?: (slug: string) => Promise<IngestResult>;
  ocrPendingImages?: (opts: RebuildOnlyOptions) => Promise<OcrResult>;
  extractPendingExternalContent?: (
    opts: RebuildOnlyOptions,
  ) => Promise<ExternalContentResult>;
  extractPendingTranscripts?: (
    opts: RebuildOnlyOptions,
  ) => Promise<TranscriptResult>;
  processChunks?: (opts: RebuildOnlyOptions) => Promise<ChunkResult>;
  embedPendingBlocks?: (opts: RebuildOnlyOptions) => Promise<EmbedResult>;
};

export async function runFullSync(opts: {
  user: string;
  stages?: FullSyncStages;
}): Promise<FullSyncResult> {
  const username = parseUserSlug(opts.user);
  const stages = opts.stages ?? {};

  const ingest = await (stages.ingestUser ?? ingestUser)(username);
  const ocr = await (stages.ocrPendingImages ?? ocrPendingImages)({
    rebuild: false,
  });
  const externalContent = await (
    stages.extractPendingExternalContent ?? extractPendingExternalContent
  )({ rebuild: false });
  const transcripts = await (
    stages.extractPendingTranscripts ?? extractPendingTranscripts
  )({ rebuild: false });
  const chunks = await (stages.processChunks ?? processChunks)({
    rebuild: false,
  });
  const embeddings = await (stages.embedPendingBlocks ?? embedPendingBlocks)({
    rebuild: false,
  });

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
