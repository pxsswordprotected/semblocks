"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Hit } from "@/lib/search-core";
import {
  DEFAULT_RESULT_LIMIT,
  VISIBLE_ROWS_PER_PAGE,
} from "./resultLimit";

export { DEFAULT_RESULT_LIMIT, VISIBLE_ROWS_PER_PAGE };

// Module-scoped cache for fetched result sets (live `q`/`sid` and stored
// `demo`). Keyed so page-number clicks re-slice instead of refetching.
// No TTL — cleared on reload.
const cache = new Map<string, Hit[]>();

// Ephemeral owner image-search results. The query image can't live in the
// URL, so an owner image search stashes its hits here under a random token
// and navigates to `?img=<token>`. Refresh clears the map → the result is
// gone (ephemeral by design), and the hook falls back to a locked state.
const imageResults = new Map<string, Hit[]>();

export function putImageSearchResult(hits: Hit[]): string {
  const token = crypto.randomUUID();
  imageResults.set(token, hits);
  return token;
}

type IdleState = {
  status: "idle";
  hits: readonly [];
  page: 1;
  pageSize: number;
  totalCount: 0;
  hasMore: false;
  error: null;
};

type LoadingState = {
  status: "loading";
  hits: Hit[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
  error: null;
};

type ReadyState = {
  status: "ready";
  hits: Hit[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
  error: null;
};

type ErrorState = {
  status: "error";
  hits: readonly [];
  page: number;
  pageSize: number;
  totalCount: 0;
  hasMore: false;
  error: string;
};

// Non-owner tried a live search (or an owner image result expired on
// refresh). The table shows a gate message instead of calling OpenAI.
type LockedState = {
  status: "locked";
  hits: readonly [];
  page: 1;
  pageSize: number;
  totalCount: 0;
  hasMore: false;
  error: null;
};

export type SearchHitsState =
  | IdleState
  | LoadingState
  | ReadyState
  | ErrorState
  | LockedState;

// The hook exposes a single retry() callback alongside the state so the
// error UI can re-run the most recent failed request without forcing the
// user to retype.
export type UseSearchHitsResult = SearchHitsState & { retry: () => void };

function parsePositiveInt(raw: string | null, def: number): number {
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : def;
}

function idle(pageSize: number): IdleState {
  return {
    status: "idle",
    hits: [],
    page: 1,
    pageSize,
    totalCount: 0,
    hasMore: false,
    error: null,
  };
}

function locked(pageSize: number): LockedState {
  return {
    status: "locked",
    hits: [],
    page: 1,
    pageSize,
    totalCount: 0,
    hasMore: false,
    error: null,
  };
}

function ready(hits: Hit[], page: number, pageSize: number): ReadyState {
  const totalCount = hits.length;
  return {
    status: "ready",
    hits,
    page,
    pageSize,
    totalCount,
    hasMore: totalCount > page * pageSize,
    error: null,
  };
}

function loading(page: number, pageSize: number): LoadingState {
  return {
    status: "loading",
    hits: [],
    page,
    pageSize,
    totalCount: 0,
    hasMore: false,
    error: null,
  };
}

function fail(message: string, page: number, pageSize: number): ErrorState {
  return {
    status: "error",
    hits: [],
    page,
    pageSize,
    totalCount: 0,
    hasMore: false,
    error: message,
  };
}

// Body of the search response from /api/search GET.
type SearchResponse = { query: string; hits: Hit[] } | { error: string };
// Body of /api/demo-searches/[id] GET.
type DemoResponse =
  | { demo: { result: { query: string; hits: Hit[] } } }
  | { error: string };

type Source = "none" | "live" | "demo" | "img" | "locked";

export function useSearchHits(
  resultLimit = DEFAULT_RESULT_LIMIT,
  ownerMode = false,
): UseSearchHitsResult {
  const params = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const sid = (params.get("sid") ?? "").trim();
  const demo = (params.get("demo") ?? "").trim();
  const img = (params.get("img") ?? "").trim();
  const channels = (params.get("channels") ?? "").trim();
  const page = parsePositiveInt(params.get("page"), 1);
  const pageSize = VISIBLE_ROWS_PER_PAGE;
  const safeResultLimit = Number.isFinite(resultLimit)
    ? Math.max(1, Math.floor(resultLimit))
    : DEFAULT_RESULT_LIMIT;

  // Source precedence: demo (public snapshot) → img (owner ephemeral) →
  // live (owner q/sid). Live is locked for non-owners.
  const source: Source = demo
    ? "demo"
    : img
      ? "img"
      : q || sid
        ? ownerMode
          ? "live"
          : "locked"
        : "none";

  const key = demo
    ? `demo:${demo}`
    : `${sid ? `sid:${sid}` : `q:${q}`}|channels:${channels}|k:${safeResultLimit}`;

  // Bumping this counter re-runs the fetch effect for retry.
  const [retryNonce, setRetryNonce] = useState(0);

  const [state, setState] = useState<SearchHitsState>(() => {
    if (source === "none") return idle(pageSize);
    if (source === "locked") return locked(pageSize);
    if (source === "img") {
      const hits = imageResults.get(img);
      return hits ? ready(hits, page, pageSize) : locked(pageSize);
    }
    const cached = cache.get(key);
    return cached ? ready(cached, page, pageSize) : loading(page, pageSize);
  });

  useEffect(() => {
    if (source === "none") {
      setState(idle(pageSize));
      return;
    }
    if (source === "locked") {
      setState(locked(pageSize));
      return;
    }
    if (source === "img") {
      const hits = imageResults.get(img);
      setState(hits ? ready(hits, page, pageSize) : locked(pageSize));
      return;
    }

    const cached = cache.get(key);
    if (cached) {
      setState(ready(cached, page, pageSize));
      return;
    }

    const ctrl = new AbortController();
    setState(loading(page, pageSize));

    (async () => {
      try {
        const url =
          source === "demo"
            ? `/api/demo-searches/${encodeURIComponent(demo)}`
            : (() => {
                const rp = new URLSearchParams();
                if (sid) rp.set("sid", sid);
                else rp.set("q", q);
                rp.set("k", String(safeResultLimit));
                if (channels) rp.set("channels", channels);
                return `/api/search?${rp.toString()}`;
              })();

        const res = await fetch(url, { signal: ctrl.signal });
        const body = (await res.json()) as SearchResponse | DemoResponse;
        if (ctrl.signal.aborted) return;
        if (!res.ok || "error" in body) {
          throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
        }
        const hits = "demo" in body ? body.demo.result.hits : body.hits;
        cache.set(key, hits);
        setState(ready(hits, page, pageSize));
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setState(fail(message, page, pageSize));
      }
    })();

    return () => ctrl.abort();
  }, [
    source,
    q,
    sid,
    demo,
    img,
    channels,
    page,
    pageSize,
    safeResultLimit,
    key,
    retryNonce,
  ]);

  const retry = useCallback(() => {
    cache.delete(key);
    setRetryNonce((n) => n + 1);
  }, [key]);

  return { ...state, retry };
}
