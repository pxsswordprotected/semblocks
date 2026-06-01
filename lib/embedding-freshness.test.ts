import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  BLOCK_EMBED_INPUT_MAX_CHARS,
  blockEmbeddingInput,
  hashEmbeddingInput,
  isEmbeddingFresh,
} from "./embedding-freshness.ts";

test("hashEmbeddingInput hashes the exact input deterministically", () => {
  const input = "same bytes every time";
  const expected = createHash("sha256").update(input).digest("hex");

  assert.equal(hashEmbeddingInput(input), expected);
  assert.equal(hashEmbeddingInput(input), hashEmbeddingInput(input));
  assert.notEqual(hashEmbeddingInput(input), hashEmbeddingInput(`${input} `));
});

test("blockEmbeddingInput truncates before hashing", () => {
  const input = `${"a".repeat(BLOCK_EMBED_INPUT_MAX_CHARS)}tail`;
  const truncated = blockEmbeddingInput(input);

  assert.equal(truncated.length, BLOCK_EMBED_INPUT_MAX_CHARS);
  assert.equal(truncated, "a".repeat(BLOCK_EMBED_INPUT_MAX_CHARS));
  assert.equal(hashEmbeddingInput(truncated), hashEmbeddingInput(blockEmbeddingInput(input)));
  assert.notEqual(hashEmbeddingInput(input), hashEmbeddingInput(truncated));
});

test("isEmbeddingFresh requires vector, matching input hash, and matching model", () => {
  const inputHash = hashEmbeddingInput("input");
  const model = "model-a";

  assert.equal(
    isEmbeddingFresh({ hasVector: true, input_hash: inputHash, embedding_model: model }, inputHash, model),
    true,
  );
  assert.equal(
    isEmbeddingFresh({ hasVector: false, input_hash: inputHash, embedding_model: model }, inputHash, model),
    false,
  );
  assert.equal(
    isEmbeddingFresh({ hasVector: true, input_hash: "stale", embedding_model: model }, inputHash, model),
    false,
  );
  assert.equal(
    isEmbeddingFresh({ hasVector: true, input_hash: inputHash, embedding_model: "model-b" }, inputHash, model),
    false,
  );
});
