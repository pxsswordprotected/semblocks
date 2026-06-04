"use client";

import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import {
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";
import {
  Image as ImageIcon,
  MagnifyingGlass,
} from "@phosphor-icons/react/dist/ssr";
import Button from "@/components/Button";
import { Panel } from "@/components/dashboard/panel";
import { QUERY_IMAGE_MAX_BYTES } from "@/lib/query-image-limits";
import { cn } from "@/lib/utils";
import { putImageSearchResult } from "../blocks-table/useSearchHits";
import type { Hit } from "@/lib/search-core";

const LONG_QUERY_THRESHOLD = 300;

type SearchSessionCreateResponse =
  | { sid: string; reused: boolean; expires_at: string }
  | { error: string };

type SearchSessionGetResponse =
  | { sid: string; q: string; expires_at: string }
  | { error: string };

type ImageSearchResponse =
  | { query: string; hits: Hit[] }
  | { error: string };

type DemoSummary = { id: string; label: string; is_image: boolean };
type DemoListResponse = { demos: DemoSummary[] } | { error: string };

// Outer shell. Splits the param-reading subtree behind a Suspense
// boundary so useSearchParams doesn't de-opt the route to client-render
// at prerender time.
export function SearchCard({
  className,
  ownerMode = false,
}: {
  className?: string;
  ownerMode?: boolean;
}) {
  return (
    <Panel className={cn("relative flex items-center justify-center px-6", className)}>
      <Suspense fallback={<SearchForm initialQuery="" initialSid="" ownerMode={ownerMode} />}>
        <SearchFormFromParams ownerMode={ownerMode} />
      </Suspense>
    </Panel>
  );
}

function SearchFormFromParams({ ownerMode }: { ownerMode: boolean }) {
  const params = useSearchParams();
  return (
    <SearchForm
      initialQuery={params.get("q") ?? ""}
      initialSid={params.get("sid") ?? ""}
      params={params}
      ownerMode={ownerMode}
    />
  );
}

function SearchForm({
  initialQuery,
  initialSid,
  params,
  ownerMode,
}: {
  initialQuery: string;
  initialSid: string;
  params?: ReadonlyURLSearchParams | null;
  ownerMode: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [searching, setSearching] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [demos, setDemos] = useState<DemoSummary[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const hasText = query.trim().length > 0;
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!initialSid) {
      setQuery(initialQuery);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/search-sessions/${encodeURIComponent(initialSid)}`,
        );
        const body = (await res.json()) as SearchSessionGetResponse;
        if (cancelled) return;
        if (!res.ok || "error" in body) {
          throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
        }
        setQuery(body.q);
      } catch (err) {
        if (!cancelled) {
          console.error("[SearchCard] search session", err);
          setQuery("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialQuery, initialSid]);

  // Non-owners get demo searches instead of live search.
  useEffect(() => {
    if (ownerMode) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/demo-searches?kind=search");
        const body = (await res.json()) as DemoListResponse;
        if (cancelled || !res.ok || "error" in body) return;
        setDemos(body.demos);
      } catch {
        // demos are optional; ignore failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerMode]);

  function navigateSource(kind: "q" | "sid" | "img" | "demo", value: string) {
    const next = new URLSearchParams(params ?? undefined);
    for (const k of ["q", "sid", "img", "demo", "page"]) next.delete(k);
    next.set(kind, value);
    removeEmptyParams(next);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  }

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || searching) return;
    if (!ownerMode) {
      setGateOpen(true);
      return;
    }

    try {
      setSearching(true);
      if (trimmed.length <= LONG_QUERY_THRESHOLD) {
        navigateSource("q", trimmed);
      } else {
        const res = await fetch("/api/search-sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: trimmed }),
        });
        const body = (await res.json()) as SearchSessionCreateResponse;
        if (!res.ok || "error" in body) {
          throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
        }
        navigateSource("sid", body.sid);
      }
    } catch (err) {
      console.error("[SearchCard]", err);
    } finally {
      setSearching(false);
    }
  }

  async function submitImage(file: File) {
    if (!ownerMode) {
      setGateOpen(true);
      return;
    }
    if (!file.type.startsWith("image/")) return;
    if (file.size > QUERY_IMAGE_MAX_BYTES) {
      console.error("[SearchCard] image too large");
      return;
    }
    setSearching(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch(`/api/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_data_url: dataUrl }),
      });
      const body = (await res.json()) as ImageSearchResponse;
      if (!res.ok || "error" in body) {
        throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
      }
      // Stash ephemerally and route to ?img=<token>; the table reads it.
      const token = putImageSearchResult(body.hits);
      setQuery("");
      navigateSource("img", token);
    } catch (err) {
      console.error("[SearchCard]", err);
    } finally {
      setSearching(false);
    }
  }

  return (
    <>
      <form onSubmit={submitText} className="flex w-full items-center gap-3">
        <button
          type="submit"
          aria-label="Search"
          disabled={(!hasText && ownerMode) || searching}
          className={cn(
            "shrink-0",
            hasText ? "text-neutral-800" : "text-black/50",
          )}
        >
          <MagnifyingGlass size={26} />
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (!ownerMode) setGateOpen(true);
          }}
          placeholder="Search"
          className="min-w-0 flex-1 bg-transparent text-neutral-800 outline-none placeholder:text-black/50 disabled:opacity-60"
        />
        <Button
          type="button"
          aria-label="Search by image"
          disabled={searching}
          onClick={() => {
            if (!ownerMode) setGateOpen(true);
            else fileRef.current?.click();
          }}
          className="flex items-center justify-center px-0 py-0 w-9 h-9"
        >
          <ImageIcon size={26} />
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void submitImage(file);
          }}
        />
      </form>

      {!ownerMode && gateOpen ? (
        <DemoGate
          demos={demos}
          onPick={(id) => {
            setGateOpen(false);
            navigateSource("demo", id);
          }}
          onClose={() => setGateOpen(false)}
        />
      ) : null}
    </>
  );
}

function DemoGate({
  demos,
  onPick,
  onClose,
}: {
  demos: DemoSummary[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute top-full left-0 z-20 mt-2 w-full rounded-base border border-stroke bg-white p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-5 text-black/60">
          Live search uses an OpenAI key. Clone the project to run it on your own
          data and key. For now, try a demo search:
        </p>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="shrink-0 text-sm text-black/40 hover:text-black/70"
        >
          ✕
        </button>
      </div>
      {demos.length === 0 ? (
        <p className="mt-3 text-sm text-black/40">No demo searches available.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {demos.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onPick(d.id)}
              className="rounded-full border border-stroke px-3 py-1 text-sm text-neutral-800 hover:bg-black/5"
            >
              {d.is_image ? "🖼 " : ""}
              {d.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function removeEmptyParams(params: URLSearchParams) {
  for (const [key, value] of Array.from(params.entries())) {
    if (value === "") params.delete(key);
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => {
    const r = reader.result;
    if (typeof r === "string") resolve(r);
    else reject(new Error("FileReader produced non-string result"));
  };
  reader.onerror = () => reject(reader.error ?? new Error("read failed"));
  reader.readAsDataURL(file);
  return promise;
}
