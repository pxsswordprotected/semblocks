import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientEmbeddingError,
  withEmbeddingRetries,
} from "./embedding-retry.ts";

test("isTransientEmbeddingError detects premature close embedding failures", () => {
  assert.equal(
    isTransientEmbeddingError(
      new Error(
        "Invalid response body while trying to fetch https://api.openai.com/v1/embeddings: Premature close",
      ),
    ),
    true,
  );
  assert.equal(isTransientEmbeddingError({ status: 429 }), true);
  assert.equal(isTransientEmbeddingError({ code: "ECONNRESET" }), true);
  assert.equal(isTransientEmbeddingError({ status: 400, message: "bad request" }), false);
});

test("withEmbeddingRetries retries transient failures only", async () => {
  let attempts = 0;
  const result = await withEmbeddingRetries(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("Premature close");
      return "ok";
    },
    { sleep: async () => {} },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("withEmbeddingRetries calls the transient error hook before retrying", async () => {
  let attempts = 0;
  const retryAttempts: number[] = [];
  await withEmbeddingRetries(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Premature close");
      return "ok";
    },
    {
      sleep: async () => {},
      onTransientError: (_err, attempt) => retryAttempts.push(attempt),
    },
  );

  assert.deepEqual(retryAttempts, [1]);
});

test("withEmbeddingRetries does not retry non-transient failures", async () => {
  let attempts = 0;
  await assert.rejects(
    withEmbeddingRetries(
      async () => {
        attempts += 1;
        throw Object.assign(new Error("bad input"), { status: 400 });
      },
      { sleep: async () => {} },
    ),
  );
  assert.equal(attempts, 1);
});
