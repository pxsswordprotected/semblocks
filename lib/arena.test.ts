import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getAllChannelBlocks,
  getChannelContents,
  resetArenaRateLimitForTest,
  type ArenaBlock,
  type ArenaChannel,
  type ArenaList,
  type ArenaContentItem,
} from "./arena.ts";

function block(id: number): ArenaBlock {
  return { id, type: "Text", base_type: "Block" };
}

function channel(id: number): ArenaChannel {
  return { id, slug: `channel-${id}`, title: `Channel ${id}`, base_type: "Channel" };
}

function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

async function withArenaFetch(
  fetchImpl: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalInterval = process.env.ARENA_MIN_REQUEST_INTERVAL_MS;
  globalThis.fetch = fetchImpl;
  process.env.ARENA_MIN_REQUEST_INTERVAL_MS = "0";
  resetArenaRateLimitForTest();
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalInterval === undefined) {
      delete process.env.ARENA_MIN_REQUEST_INTERVAL_MS;
    } else {
      process.env.ARENA_MIN_REQUEST_INTERVAL_MS = originalInterval;
    }
    resetArenaRateLimitForTest();
  }
}

test("getAllChannelBlocks returns one drained content page", async () => {
  const requests: URL[] = [];
  await withArenaFetch(
    async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(url.searchParams.get("page"), "1");
      assert.equal(url.searchParams.get("per"), "100");
      const body: ArenaList<ArenaContentItem> = {
        data: [block(1), channel(2), block(3)],
        meta: { current_page: 1, total_pages: 1, total_count: 3 },
      };
      return jsonResponse(body);
    },
    async () => {
      const blocks = await getAllChannelBlocks("source-channel");
      assert.deepEqual(
        blocks.map((b) => b.id),
        [1, 3],
      );
      assert.equal(requests.length, 1);
    },
  );
});

test("getAllChannelBlocks drains multiple per=100 content pages", async () => {
  const pages: number[] = [];
  await withArenaFetch(
    async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page"));
      pages.push(page);
      assert.equal(url.searchParams.get("per"), "100");
      const data =
        page === 1
          ? Array.from({ length: 100 }, (_, i) => block(i + 1))
          : Array.from({ length: 25 }, (_, i) => block(i + 101));
      const body: ArenaList<ArenaContentItem> = {
        data,
        meta: {
          current_page: page,
          total_pages: 2,
          total_count: 125,
          has_more_pages: page < 2,
        },
      };
      return jsonResponse(body);
    },
    async () => {
      const blocks = await getAllChannelBlocks(123);
      assert.equal(blocks.length, 125);
      assert.deepEqual(pages, [1, 2]);
      assert.equal(blocks[124]?.id, 125);
    },
  );
});

test("arena fetch retries 429 responses after Retry-After", async () => {
  let calls = 0;
  await withArenaFetch(
    async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      const body: ArenaList<ArenaContentItem> = {
        data: [],
        meta: { current_page: 1, total_pages: 1, total_count: 0 },
      };
      return jsonResponse(body);
    },
    async () => {
      const res = await getChannelContents("retry-channel");
      assert.deepEqual(res.data, []);
      assert.equal(calls, 2);
    },
  );
});
