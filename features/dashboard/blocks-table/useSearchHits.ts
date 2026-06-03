"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Hit } from "@/lib/search-core";

// Default page size; matches the Channels card cadence. Exported so
// BlocksTableContent can size its slot count to the same value — that
// keeps the auto-distributed inter-row gap identical across pages
// whether or not the current page is full.
export const DEFAULT_PAGE_SIZE = 8;

// Module-scoped cache. The server today returns the full top-N for any
// given q/channels pair regardless of page/pageSize (client slices), so
// we key the cache on q plus channels — clicking page numbers becomes a
// free re-slice instead of a refetch of identical data, while changing
// the active channel filter gets an isolated result set. When server-side
// pagination lands, the key gains the `:${page}:${pageSize}` suffix and
// nothing else in the hook changes. No TTL — cleared on reload.
const cache = new Map<string, Hit[]>();

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

export type SearchHitsState =
  | IdleState
  | LoadingState
  | ReadyState
  | ErrorState;

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

function fail(
  message: string,
  page: number,
  pageSize: number,
): ErrorState {
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

export function useSearchHits(): UseSearchHitsResult {
  const params = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const sid = (params.get("sid") ?? "").trim();
  const channels = (params.get("channels") ?? "").trim();
  const page = parsePositiveInt(params.get("page"), 1);
  const pageSize = parsePositiveInt(
    params.get("pageSize"),
    DEFAULT_PAGE_SIZE,
  );
  const hasSearch = Boolean(sid || q);
  // Cache key — see comment on `cache` at top-of-file for why this is
  // query/channels only and not the full `${query}:${channels}:${page}:${pageSize}`.
  const key = `${sid ? `sid:${sid}` : `q:${q}`}|channels:${channels}`;
  // Bumping this counter re-runs the fetch effect for retry.
  const [retryNonce, setRetryNonce] = useState(0);

  // Initial state: idle when q is empty, ready when the exact key is
  // already cached (back/forward feels instant), loading otherwise. This
  // also avoids a one-frame "loading" flash on cache hits.
  const [state, setState] = useState<SearchHitsState>(() => {
    if (!hasSearch) return idle(pageSize);
    const cached = cache.get(key);
    return cached ? ready(cached, page, pageSize) : loading(page, pageSize);
  });

  useEffect(() => {
    if (!hasSearch) {
      setState(idle(pageSize));
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
        const requestParams = new URLSearchParams();
        if (sid) requestParams.set("sid", sid);
        else requestParams.set("q", q);
        if (channels) requestParams.set("channels", channels);
        const res = await fetch(`/api/search?${requestParams.toString()}`, {
          signal: ctrl.signal,
        });
        const body = (await res.json()) as SearchResponse;
        if (ctrl.signal.aborted) return;
        if (!res.ok || "error" in body) {
          const msg =
            "error" in body ? body.error : `HTTP ${res.status}`;
          throw new Error(msg);
        }
        cache.set(key, body.hits);
        setState(ready(body.hits, page, pageSize));
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setState(fail(message, page, pageSize));
      }
    })();

    return () => ctrl.abort();
    // retryNonce is intentionally a dependency: bumping it forces the
    // effect to re-run with the same q/channels/page/pageSize.
  }, [hasSearch, q, sid, channels, page, pageSize, key, retryNonce]);

  const retry = useCallback(() => {
    cache.delete(key);
    setRetryNonce((n) => n + 1);
  }, [key]);

  return { ...state, retry };
}
