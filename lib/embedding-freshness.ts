import { createHash } from "node:crypto";

export const BLOCK_EMBED_INPUT_MAX_CHARS = 8000;

export type EmbeddingFreshness = {
  hasVector: boolean;
  input_hash: string | null;
  embedding_model: string | null;
};

export function blockEmbeddingInput(searchText: string): string {
  return searchText.slice(0, BLOCK_EMBED_INPUT_MAX_CHARS);
}

export function hashEmbeddingInput(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function isEmbeddingFresh(
  row: EmbeddingFreshness,
  inputHash: string,
  embeddingModel: string,
): boolean {
  return (
    row.hasVector &&
    row.input_hash === inputHash &&
    row.embedding_model === embeddingModel
  );
}
