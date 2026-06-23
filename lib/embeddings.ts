import OpenAI from "openai";
import { Agent as HttpsAgent } from "node:https";
import { withEmbeddingRetries } from "./embedding-retry.ts";

export const EMBEDDING_MODEL = "text-embedding-3-small";

let _client: OpenAI | null = null;
const OPENAI_HTTP_AGENT = new HttpsAgent({
  keepAlive: false,
  family: 4,
});


function client(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  _client = new OpenAI({
    apiKey,
    httpAgent: OPENAI_HTTP_AGENT,
    timeout: 30_000,
  });
  return _client;
}

export async function embed(input: string): Promise<Float32Array> {
  const res = await withEmbeddingRetries(
    () =>
      client().embeddings.create({
        model: EMBEDDING_MODEL,
        input,
      }),
    { onTransientError: resetClient },
  );
  return new Float32Array(res.data[0].embedding);
}

export async function embedMany(inputs: string[]): Promise<Float32Array[]> {
  if (inputs.length === 0) return [];
  const res = await withEmbeddingRetries(
    () =>
      client().embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs,
      }),
    { onTransientError: resetClient },
  );
  return res.data.map((d) => new Float32Array(d.embedding));
}

function resetClient(): void {
  _client = null;
}
