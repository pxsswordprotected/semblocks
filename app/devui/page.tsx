"use client";

import { useRef, useState } from "react";

import { QUERY_IMAGE_MAX_BYTES } from "@/lib/query-image-limits";

// Resolve a picked File to a `data:<mime>;base64,…` URL. The vision
// endpoint takes the data URL verbatim, so no further decoding needed.
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("unexpected FileReader result"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("failed to read file"));
    reader.readAsDataURL(file);
  });
}

type Block = {
  id: number;
  title: string;
  type: string;
  position?: number;
  source_url?: string;
  content?: string;
  content_html?: string;
};

type Channel = {
  id: number;
  slug: string;
  title: string;
  total: number;
  blocks: Block[];
};

type IndexedChannel = {
  id: number;
  title: string | null;
  slug: string | null;
  block_count: number;
};

type ArenaResponse = {
  user: { slug: string; name: string; channel_count?: number };
  channels: Channel[];
  meta: { channels_shown: number; channels_total: number };
};

type SearchHit = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  source_url: string | null;
  arena_url: string | null;
  snippet: string | null;
  channel_title: string | null;
  channel_url: string | null;
  distance: number;
  vec_distance: number;
  match_type?: "block" | "chunk";
  chunk_index?: number;
  source_start_char?: number;
  source_end_char?: number;
};

type RecTopBlock = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  arena_url: string | null;
  vec_distance: number;
};

type RecChannel = {
  channel_id: number;
  channel_title: string | null;
  channel_url: string | null;
  raw_score: number;
  score: number;
  channel_size: number;
  block_count: number;
  top_blocks: RecTopBlock[];
};

type RecRelatedBlock = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  arena_url: string | null;
  channel_title: string | null;
  channel_url: string | null;
  vec_distance: number;
};

type RecResponse = {
  input_chars: number;
  channels: RecChannel[];
  related_blocks: RecRelatedBlock[];
  caption_meta?: { ocr_text: string; ocr_summary: string | null };
};

export default function Page() {
  const [input, setInput] = useState("");
  const [data, setData] = useState<ArenaResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [embedding, setEmbedding] = useState(false);
  const [embedStatus, setEmbedStatus] = useState<string | null>(null);
  const [ocring, setOcring] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [extLoading, setExtLoading] = useState(false);
  const [extStatus, setExtStatus] = useState<string | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [chunking, setChunking] = useState(false);
  const [chunkStatus, setChunkStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchImage, setSearchImage] = useState<string | null>(null);
  const [searchCaption, setSearchCaption] = useState<{
    ocr_text: string;
    ocr_summary: string | null;
  } | null>(null);
  const [searchCaptionOpen, setSearchCaptionOpen] = useState(false);
  const [searchTranscriptionOpen, setSearchTranscriptionOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [channels, setChannels] = useState<IndexedChannel[] | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [recText, setRecText] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recResult, setRecResult] = useState<RecResponse | null>(null);
  const [recRelatedOpen, setRecRelatedOpen] = useState(false);
  const [recCaption, setRecCaption] = useState<{
    ocr_text: string;
    ocr_summary: string | null;
  } | null>(null);
  const [recCaptionOpen, setRecCaptionOpen] = useState(false);
  const [recTranscriptionOpen, setRecTranscriptionOpen] = useState(false);
  const recFileInputRef = useRef<HTMLInputElement | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    setData(null);
    setSaveStatus(null);
    try {
      const res = await fetch(
        `/api/arena?user=${encodeURIComponent(input.trim())}`,
      );
      const body = (await res.json()) as
        | ArenaResponse
        | { error: string; status?: number };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!input.trim()) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch(
        `/api/arena/ingest?user=${encodeURIComponent(input.trim())}`,
        { method: "POST" },
      );
      const body = (await res.json()) as
        | {
            user_id: number;
            channel_count: number;
            block_count: number;
            link_count: number;
            failed_channels: string[];
          }
        | { error: string; status?: number };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        setSaveStatus(`error: ${msg}`);
        return;
      }
      const failed = body.failed_channels.length
        ? ` (${body.failed_channels.length} channels failed)`
        : "";
      setSaveStatus(
        `saved: ${body.channel_count} channels, ${body.block_count} blocks, ${body.link_count} links${failed}`,
      );
    } catch (err) {
      setSaveStatus(
        `error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function onEmbed(rebuild = false) {
    setEmbedding(true);
    setEmbedStatus(null);
    try {
      const url = rebuild ? `/api/embed?rebuild=1` : `/api/embed`;
      const res = await fetch(url, { method: "POST" });
      const body = (await res.json()) as
        | {
            embedded: number;
            skipped: number;
            batches: number;
            cleared: number;
          }
        | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        setEmbedStatus(`error: ${msg}`);
        return;
      }
      const clearedPart = body.cleared > 0 ? `cleared ${body.cleared}, ` : "";
      setEmbedStatus(
        body.embedded === 0
          ? `${clearedPart}nothing pending`
          : `${clearedPart}embedded ${body.embedded} block${body.embedded === 1 ? "" : "s"} in ${body.batches} batch${body.batches === 1 ? "" : "es"}`,
      );
    } catch (err) {
      setEmbedStatus(
        `error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setEmbedding(false);
    }
  }

  async function onOcr(rebuild = false) {
    setOcring(true);
    setOcrStatus(null);
    try {
      const url = rebuild ? `/api/ocr?rebuild=1` : `/api/ocr`;
      const res = await fetch(url, { method: "POST" });
      const body = (await res.json()) as
        | {
            processed: number;
            errors: number;
            skipped: number;
            cleared: number;
          }
        | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        setOcrStatus(`error: ${msg}`);
        return;
      }
      const clearedPart = body.cleared > 0 ? `cleared ${body.cleared}, ` : "";
      const suffix =
        body.processed > 0 ? " → click Rebuild to refresh embeddings" : "";
      setOcrStatus(
        body.processed === 0 && body.errors === 0
          ? `${clearedPart}nothing pending`
          : `${clearedPart}OCR'd ${body.processed}, ${body.errors} error${body.errors === 1 ? "" : "s"}${suffix}`,
      );
    } catch (err) {
      setOcrStatus(
        `error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setOcring(false);
    }
  }

  async function onExternalContent(rebuild = false) {
    setExtLoading(true);
    setExtStatus(null);
    try {
      const url = rebuild
        ? `/api/external-content?rebuild=1`
        : `/api/external-content`;
      const res = await fetch(url, { method: "POST" });
      const body = (await res.json()) as
        | {
            processed: number;
            errors: number;
            skipped: number;
            cleared: number;
          }
        | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        setExtStatus(`error: ${msg}`);
        return;
      }
      const clearedPart = body.cleared > 0 ? `cleared ${body.cleared}, ` : "";
      const skippedPart = body.skipped > 0 ? `, ${body.skipped} skipped` : "";
      const suffix =
        body.processed > 0
          ? " → click Embed to refresh block vectors, Process chunks to embed PDF passages"
          : "";
      setExtStatus(
        body.processed === 0 && body.errors === 0 && body.skipped === 0
          ? `${clearedPart}nothing pending`
          : `${clearedPart}read ${body.processed}, ${body.errors} error${body.errors === 1 ? "" : "s"}${skippedPart}${suffix}`,
      );
    } catch (err) {
      setExtStatus(
        `error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setExtLoading(false);
    }
  }

  async function onTranscripts(rebuild = false) {
    setTxLoading(true);
    setTxStatus(null);
    try {
      const url = rebuild ? `/api/transcripts?rebuild=1` : `/api/transcripts`;
      const res = await fetch(url, { method: "POST" });
      const body = (await res.json()) as
        | {
            processed: number;
            errors: number;
            skipped: number;
            cleared: number;
          }
        | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        setTxStatus(`error: ${msg}`);
        return;
      }
      const clearedPart = body.cleared > 0 ? `cleared ${body.cleared}, ` : "";
      const skippedPart = body.skipped > 0 ? `, ${body.skipped} skipped` : "";
      const suffix =
        body.processed > 0
          ? " → click Embed to refresh block vectors, Process chunks to embed transcript passages"
          : "";
      setTxStatus(
        body.processed === 0 && body.errors === 0 && body.skipped === 0
          ? `${clearedPart}nothing pending`
          : `${clearedPart}fetched ${body.processed}, ${body.errors} error${body.errors === 1 ? "" : "s"}${skippedPart}${suffix}`,
      );
    } catch (err) {
      setTxStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTxLoading(false);
    }
  }

  async function onProcessChunks() {
    setChunking(true);
    setChunkStatus(null);
    try {
      const res = await fetch(`/api/chunks`, { method: "POST" });
      const body = (await res.json()) as
        | {
            chunked: number;
            embedded: number;
            skipped: number;
            batches: number;
            cleared: number;
          }
        | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        setChunkStatus(`error: ${msg}`);
        return;
      }
      const skippedPart = body.skipped > 0 ? `, ${body.skipped} skipped` : "";
      setChunkStatus(
        body.chunked === 0 && body.embedded === 0
          ? "nothing pending"
          : `chunked ${body.chunked}, embedded ${body.embedded} chunk${body.embedded === 1 ? "" : "s"} in ${body.batches} batch${body.batches === 1 ? "" : "es"}${skippedPart}`,
      );
    } catch (err) {
      setChunkStatus(
        `error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setChunking(false);
    }
  }

  async function loadChannels() {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const res = await fetch(`/api/channels`);
      const body = (await res.json()) as
        | { channels: IndexedChannel[] }
        | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setChannels(body.channels);
    } catch (err) {
      setChannelsError(err instanceof Error ? err.message : String(err));
    } finally {
      setChannelsLoading(false);
    }
  }

  function onToggleFilterPanel() {
    const next = !filterOpen;
    setFilterOpen(next);
    if (next && channels === null && !channelsLoading) {
      loadChannels();
    }
  }

  function onToggleChannel(id: number) {
    setSelectedChannelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSelectAllChannels() {
    if (!channels) return;
    setSelectedChannelIds(
      new Set(channels.filter((c) => c.block_count > 0).map((c) => c.id)),
    );
  }

  function onClearChannels() {
    setSelectedChannelIds(new Set());
  }

  function channelFilterParam(): string {
    if (selectedChannelIds.size === 0) return "";
    return `&channels=${[...selectedChannelIds].join(",")}`;
  }

  function selectedChannelLabel(): string {
    const n = selectedChannelIds.size;
    if (n === 0) return "All channels";
    if (n === 1) return "1 channel selected";
    return `${n} channels selected`;
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setHits(null);
    setSearchImage(null);
    setSearchCaption(null);
    setSearchCaptionOpen(false);
    setSearchTranscriptionOpen(false);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(query.trim())}${channelFilterParam()}`,
      );
      const body = (await res.json()) as
        | { query: string; hits: SearchHit[] }
        | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setHits(body.hits);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function onPickSearchImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setSearchError("please pick an image file");
      return;
    }
    if (file.size > QUERY_IMAGE_MAX_BYTES) {
      const mb = (QUERY_IMAGE_MAX_BYTES / (1024 * 1024)).toFixed(0);
      setSearchError(`image too large (max ${mb} MB)`);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setHits(null);
    setSearchCaption(null);
    setSearchCaptionOpen(false);
    setSearchTranscriptionOpen(false);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setSearchImage(dataUrl);
      const res = await fetch(`/api/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          selectedChannelIds.size > 0
            ? { image_data_url: dataUrl, channels: [...selectedChannelIds] }
            : { image_data_url: dataUrl },
        ),
      });
      const body = (await res.json()) as
        | {
            query: string;
            caption_meta: { ocr_text: string; ocr_summary: string | null };
            hits: SearchHit[];
          }
        | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setHits(body.hits);
      setSearchCaption(body.caption_meta);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function onRecommendChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!recText.trim()) return;
    setRecBusy(true);
    setRecError(null);
    setRecResult(null);
    setRecCaption(null);
    setRecCaptionOpen(false);
    setRecTranscriptionOpen(false);
    try {
      const res = await fetch(`/api/recommend-channel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: recText }),
      });
      const body = (await res.json()) as RecResponse | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setRecResult(body);
    } catch (err) {
      setRecError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecBusy(false);
    }
  }

  async function onPickRecImage(file: File) {
    if (!file.type.startsWith("image/")) {
      setRecError("please pick an image file");
      return;
    }
    if (file.size > QUERY_IMAGE_MAX_BYTES) {
      const mb = (QUERY_IMAGE_MAX_BYTES / (1024 * 1024)).toFixed(0);
      setRecError(`image too large (max ${mb} MB)`);
      return;
    }
    setRecBusy(true);
    setRecError(null);
    setRecResult(null);
    setRecRelatedOpen(false);
    setRecCaption(null);
    setRecCaptionOpen(false);
    setRecTranscriptionOpen(false);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch(`/api/recommend-channel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_data_url: dataUrl }),
      });
      const body = (await res.json()) as RecResponse | { error: string };
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setRecResult(body);
      if (body.caption_meta) setRecCaption(body.caption_meta);
    } catch (err) {
      setRecError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 font-mono text-sm">
      <h1 className="mb-6 text-2xl font-semibold">SemBlocks</h1>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="are.na profile URL or slug"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "…" : "Fetch"}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !input.trim()}
          className="rounded border border-neutral-900 px-4 py-2 text-neutral-900 disabled:opacity-50"
        >
          {saving ? "…" : "Save to DB"}
        </button>
        <button
          type="button"
          onClick={() => onEmbed(false)}
          disabled={embedding}
          className="rounded border border-neutral-900 px-4 py-2 text-neutral-900 disabled:opacity-50"
        >
          {embedding ? "…" : "Embed"}
        </button>
        <button
          type="button"
          onClick={() => onEmbed(true)}
          disabled={embedding}
          title="clear vec_blocks and re-embed everything (costs ~$0.001 for 350 blocks)"
          className="rounded border border-red-700 px-3 py-2 text-red-700 disabled:opacity-50"
        >
          {embedding ? "…" : "Rebuild"}
        </button>
        <button
          type="button"
          onClick={() => onOcr(false)}
          disabled={ocring}
          title="OCR the next batch of image blocks (default 25)"
          className="rounded border border-neutral-900 px-4 py-2 text-neutral-900 disabled:opacity-50"
        >
          {ocring ? "…" : "OCR"}
        </button>
        <button
          type="button"
          onClick={() => onExternalContent(false)}
          disabled={extLoading}
          title="fetch Link + Attachment bodies via Jina Reader (default 100)"
          className="rounded border border-neutral-900 px-4 py-2 text-neutral-900 disabled:opacity-50"
        >
          {extLoading ? "…" : "Read content"}
        </button>
        <button
          type="button"
          onClick={() => onExternalContent(true)}
          disabled={extLoading}
          title="clear block_link_content for Link + Attachment blocks and re-fetch"
          className="rounded border border-red-700 px-3 py-2 text-red-700 disabled:opacity-50"
        >
          {extLoading ? "…" : "Re-read"}
        </button>
        <button
          type="button"
          onClick={() => onTranscripts(false)}
          disabled={txLoading}
          title="fetch YouTube transcripts via yt-dlp (default 100)"
          className="rounded border border-neutral-900 px-4 py-2 text-neutral-900 disabled:opacity-50"
        >
          {txLoading ? "…" : "Read YouTube transcripts"}
        </button>
        <button
          type="button"
          onClick={() => onTranscripts(true)}
          disabled={txLoading}
          title="clear block_transcripts and re-fetch via yt-dlp"
          className="rounded border border-red-700 px-3 py-2 text-red-700 disabled:opacity-50"
        >
          {txLoading ? "…" : "Re-read transcripts"}
        </button>
        <button
          type="button"
          onClick={onProcessChunks}
          disabled={chunking}
          title="build and embed chunks for long link content"
          className="rounded border border-neutral-900 px-4 py-2 text-neutral-900 disabled:opacity-50"
        >
          {chunking ? "…" : "Process chunks"}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {saveStatus && (
        <p
          className={`mt-2 text-sm ${
            saveStatus.startsWith("error") ? "text-red-600" : "text-neutral-700"
          }`}
        >
          {saveStatus}
        </p>
      )}
      {embedStatus && (
        <p
          className={`mt-2 text-sm ${
            embedStatus.startsWith("error")
              ? "text-red-600"
              : "text-neutral-700"
          }`}
        >
          {embedStatus}
        </p>
      )}
      {ocrStatus && (
        <p
          className={`mt-2 text-sm ${
            ocrStatus.startsWith("error") ? "text-red-600" : "text-neutral-700"
          }`}
        >
          {ocrStatus}
        </p>
      )}
      {extStatus && (
        <p
          className={`mt-2 text-sm ${
            extStatus.startsWith("error") ? "text-red-600" : "text-neutral-700"
          }`}
        >
          {extStatus}
        </p>
      )}
      {txStatus && (
        <p
          className={`mt-2 text-sm ${
            txStatus.startsWith("error") ? "text-red-600" : "text-neutral-700"
          }`}
        >
          {txStatus}
        </p>
      )}
      {chunkStatus && (
        <p
          className={`mt-2 text-sm ${
            chunkStatus.startsWith("error")
              ? "text-red-600"
              : "text-neutral-700"
          }`}
        >
          {chunkStatus}
        </p>
      )}

      <div className="mt-8">
        <button
          type="button"
          onClick={onToggleFilterPanel}
          className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 hover:border-neutral-500"
          aria-expanded={filterOpen}
        >
          {selectedChannelLabel()}
          <span aria-hidden="true">{filterOpen ? "▴" : "▾"}</span>
        </button>
        {filterOpen && (
          <div className="mt-2 rounded border border-neutral-300 bg-white p-3">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="font-medium text-neutral-800">
                Filter by channel
              </span>
              <button
                type="button"
                onClick={onSelectAllChannels}
                disabled={!channels || channels.length === 0}
                className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
              >
                select all
              </button>
              <button
                type="button"
                onClick={onClearChannels}
                disabled={selectedChannelIds.size === 0}
                className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
              >
                clear
              </button>
              <button
                type="button"
                onClick={() => loadChannels()}
                disabled={channelsLoading}
                title="refresh channel list"
                className="ml-auto rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
              >
                {channelsLoading ? "…" : "↻"}
              </button>
            </div>
            {channelsError && (
              <p className="mb-2 text-sm text-red-600">
                Couldn&apos;t load channels: {channelsError}.{" "}
                <button
                  type="button"
                  onClick={() => loadChannels()}
                  className="underline"
                >
                  retry
                </button>
              </p>
            )}
            {!channelsError && channelsLoading && channels === null && (
              <p className="text-sm text-neutral-500">Loading channels…</p>
            )}
            {!channelsError && channels !== null && channels.length === 0 && (
              <p className="text-sm text-neutral-500">
                No channels indexed yet. Run Save above first.
              </p>
            )}
            {channels !== null && channels.length > 0 && (
              <ul className="max-h-80 overflow-y-auto pr-1">
                {channels.map((c) => {
                  const disabled = c.block_count === 0;
                  const checked = selectedChannelIds.has(c.id);
                  return (
                    <li key={c.id}>
                      <label
                        className={`flex items-center gap-2 py-0.5 text-sm ${
                          disabled ? "text-neutral-400" : "text-neutral-800"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => onToggleChannel(c.id)}
                        />
                        <span className="truncate">
                          {c.title ?? "(untitled)"}
                        </span>
                        <span className="ml-auto text-neutral-500">
                          ({c.block_count})
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-neutral-500">
              {selectedChannelIds.size === 0
                ? "Searching all channels."
                : `${selectedChannelIds.size} channel${selectedChannelIds.size === 1 ? "" : "s"} selected.`}
            </p>
          </div>
        )}
      </div>

      <form onSubmit={onSearch} className="mt-8 flex items-center gap-2">
        {searchImage && (
          <div className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={searchImage}
              alt="search query image"
              className="h-10 w-10 rounded border border-neutral-300 object-cover"
            />
            <button
              type="button"
              onClick={() => setSearchImage(null)}
              title="clear image"
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-[10px] leading-none text-white"
            >
              ×
            </button>
          </div>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="semantic search…"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-900"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {searching ? "…" : "Search"}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={searching}
          title="caption an image with gpt-4o-mini and search the same hits"
          className="rounded border border-neutral-900 px-4 py-2 text-neutral-900 disabled:opacity-50"
        >
          {searching ? "…" : "Search image"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset value so picking the same file again re-fires onChange.
            e.target.value = "";
            if (file) void onPickSearchImage(file);
          }}
        />
      </form>
      {searchError && (
        <p className="mt-2 text-sm text-red-600">{searchError}</p>
      )}
      {searchCaption && (
        <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3 text-neutral-700">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-neutral-500">interpreted as: </span>
              <span className="text-neutral-800">
                {(() => {
                  const preview =
                    (searchCaption.ocr_summary &&
                      searchCaption.ocr_summary.trim()) ||
                    searchCaption.ocr_text.trim();
                  return preview.length > 140
                    ? preview.slice(0, 140) + "…"
                    : preview;
                })()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSearchCaptionOpen((v) => !v)}
              className="shrink-0 text-neutral-500 underline"
            >
              {searchCaptionOpen ? "show less" : "show more"}
            </button>
          </div>
          {searchCaptionOpen && (
            <div className="mt-2 space-y-2">
              {searchCaption.ocr_summary && (
                <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-800">
                  {searchCaption.ocr_summary}
                </pre>
              )}
              {searchCaption.ocr_text && (
                <div>
                  <button
                    type="button"
                    onClick={() => setSearchTranscriptionOpen((v) => !v)}
                    className="text-neutral-500 underline"
                  >
                    {searchTranscriptionOpen
                      ? "hide transcription"
                      : "show transcription"}
                  </button>
                  {searchTranscriptionOpen && (
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-neutral-800">
                      {searchCaption.ocr_text}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {hits && hits.length > 0 && selectedChannelIds.size > 0 && (
        <p className="mt-3 text-sm text-neutral-600">
          Filtered by {selectedChannelIds.size} channel
          {selectedChannelIds.size === 1 ? "" : "s"}
          {channels && (
            <>
              :{" "}
              <span className="text-neutral-800">
                {channels
                  .filter((c) => selectedChannelIds.has(c.id))
                  .map((c) => c.title ?? "(untitled)")
                  .slice(0, 4)
                  .join(", ")}
                {selectedChannelIds.size > 4 ? ", …" : ""}
              </span>
            </>
          )}
          .{" "}
          <button type="button" onClick={onClearChannels} className="underline">
            clear filter
          </button>
        </p>
      )}
      {hits && hits.length === 0 && (
        <p className="mt-2 text-sm text-neutral-500">no results</p>
      )}
      {hits && hits.length > 0 && (
        <section className="mt-4 space-y-3">
          {hits.map((h) => (
            <div
              key={h.block_id}
              className="border-l-2 border-neutral-200 pl-3"
            >
              <div>
                <span
                  className="text-neutral-500"
                  title="adjusted | raw vec | delta"
                >
                  {(() => {
                    if (process.env.NODE_ENV === "development") {
                      const delta = h.distance - h.vec_distance;
                      const sign = delta >= 0 ? "+" : "";
                      return `${h.distance.toFixed(3)} (vec ${h.vec_distance.toFixed(3)}, Δ${sign}${delta.toFixed(3)})`;
                    }
                    return h.distance.toFixed(3);
                  })()}
                </span>{" "}
                <span
                  className={
                    "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                    (h.match_type === "chunk"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-neutral-100 text-neutral-700")
                  }
                >
                  {h.match_type === "chunk"
                    ? `chunk ${h.chunk_index ?? ""}`.trim()
                    : "block"}
                </span>{" "}
                [{h.block_type ?? "?"}] {h.title ?? "Untitled"}{" "}
                <a
                  href={h.arena_url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-neutral-500 underline"
                >
                  (id {h.arena_block_id})
                </a>
              </div>
              {h.match_type === "chunk" &&
                h.source_start_char !== undefined &&
                h.source_end_char !== undefined && (
                  <div className="text-neutral-500">
                    chars {h.source_start_char}–{h.source_end_char}
                  </div>
                )}
              {h.channel_title && (
                <div className="text-neutral-500">
                  in{" "}
                  {h.channel_url ? (
                    <a
                      href={h.channel_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {h.channel_title}
                    </a>
                  ) : (
                    h.channel_title
                  )}
                </div>
              )}
              {h.snippet && (
                <div className="mt-1 whitespace-pre-wrap text-neutral-700">
                  {h.snippet}
                </div>
              )}
              {h.source_url && (
                <a
                  href={h.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-blue-600 underline break-all"
                >
                  {h.source_url}
                </a>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="mt-8">
        <button
          type="button"
          onClick={() => setRecOpen((v) => !v)}
          className="text-neutral-700 underline"
        >
          {recOpen ? "Hide rec channel" : "Rec channel"}
        </button>
        {recOpen && (
          <form onSubmit={onRecommendChannel} className="mt-3 space-y-2">
            <textarea
              value={recText}
              onChange={(e) => setRecText(e.target.value)}
              placeholder="paste text to find matching channels…"
              rows={6}
              className="w-full rounded border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={recBusy || !recText.trim()}
                className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
              >
                {recBusy ? "…" : "Recommend"}
              </button>
              <button
                type="button"
                onClick={() => recFileInputRef.current?.click()}
                disabled={recBusy}
                title="caption an image with gpt-4o-mini and rec channels"
                className="rounded border border-neutral-900 px-4 py-2 text-neutral-900 disabled:opacity-50"
              >
                {recBusy ? "…" : "Recommend from image"}
              </button>
              <input
                ref={recFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so picking the same file again re-fires onChange.
                  e.target.value = "";
                  if (file) void onPickRecImage(file);
                }}
              />
              {recResult && (
                <span className="self-center text-neutral-500">
                  {recResult.input_chars} chars analyzed
                </span>
              )}
            </div>
          </form>
        )}
        {recError && <p className="mt-2 text-sm text-red-600">{recError}</p>}
        {recCaption && (
          <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3 text-neutral-700">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-neutral-500">interpreted as: </span>
                <span className="text-neutral-800">
                  {(() => {
                    const preview =
                      (recCaption.ocr_summary &&
                        recCaption.ocr_summary.trim()) ||
                      recCaption.ocr_text.trim();
                    return preview.length > 140
                      ? preview.slice(0, 140) + "…"
                      : preview;
                  })()}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRecCaptionOpen((v) => !v)}
                className="shrink-0 text-neutral-500 underline"
              >
                {recCaptionOpen ? "show less" : "show more"}
              </button>
            </div>
            {recCaptionOpen && (
              <div className="mt-2 space-y-2">
                {recCaption.ocr_summary && (
                  <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-800">
                    {recCaption.ocr_summary}
                  </pre>
                )}
                {recCaption.ocr_text && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setRecTranscriptionOpen((v) => !v)}
                      className="text-neutral-500 underline"
                    >
                      {recTranscriptionOpen
                        ? "hide transcription"
                        : "show transcription"}
                    </button>
                    {recTranscriptionOpen && (
                      <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-neutral-800">
                        {recCaption.ocr_text}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {recResult && recResult.channels.length === 0 && (
          <p className="mt-3 text-sm text-neutral-500">
            no channels above threshold
          </p>
        )}
        {recResult && recResult.channels.length > 0 && (
          <div className="mt-4 space-y-4">
            {recResult.channels.map((c) => (
              <div
                key={c.channel_id}
                className="border-l-2 border-amber-300 pl-3"
              >
                <div>
                  <span
                    className="text-neutral-500"
                    title="score | raw_score | channel_size"
                  >
                    {c.score.toFixed(3)} (raw {c.raw_score.toFixed(3)}, size{" "}
                    {c.channel_size})
                  </span>{" "}
                  <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                    channel
                  </span>{" "}
                  {c.channel_url ? (
                    <a
                      href={c.channel_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {c.channel_title ?? "Untitled"}
                    </a>
                  ) : (
                    (c.channel_title ?? "Untitled")
                  )}{" "}
                  <span className="text-neutral-500">
                    — {c.block_count} block{c.block_count === 1 ? "" : "s"}
                  </span>
                </div>
                {c.top_blocks.length > 0 && (
                  <ul className="mt-1 space-y-0.5 pl-3">
                    {c.top_blocks.map((b) => (
                      <li key={b.block_id} className="text-neutral-700">
                        <span className="text-neutral-500">
                          {b.vec_distance.toFixed(3)}
                        </span>{" "}
                        [{b.block_type ?? "?"}] {b.title ?? "Untitled"}{" "}
                        <a
                          href={b.arena_url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="text-neutral-500 underline"
                        >
                          (id {b.arena_block_id})
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {recResult.related_blocks.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setRecRelatedOpen((v) => !v)}
                  className="text-neutral-500 underline"
                >
                  {recRelatedOpen
                    ? `Hide related blocks (${recResult.related_blocks.length})`
                    : `Show related blocks (${recResult.related_blocks.length})`}
                </button>
                {recRelatedOpen && (
                  <ul className="mt-2 space-y-1 pl-3">
                    {recResult.related_blocks.map((b) => (
                      <li
                        key={b.block_id}
                        className="border-l-2 border-neutral-200 pl-2 text-neutral-700"
                      >
                        <span className="text-neutral-500">
                          {b.vec_distance.toFixed(3)}
                        </span>{" "}
                        [{b.block_type ?? "?"}] {b.title ?? "Untitled"}{" "}
                        <a
                          href={b.arena_url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="text-neutral-500 underline"
                        >
                          (id {b.arena_block_id})
                        </a>
                        {b.channel_title && (
                          <span className="text-neutral-500">
                            {" "}
                            in{" "}
                            {b.channel_url ? (
                              <a
                                href={b.channel_url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                {b.channel_title}
                              </a>
                            ) : (
                              b.channel_title
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {data && (
        <section className="mt-8 whitespace-pre-wrap leading-relaxed">
          <div className="mb-4">
            {data.user.name} (@{data.user.slug})
            {data.user.channel_count !== undefined && (
              <>
                {" — "}
                {data.user.channel_count} channels
              </>
            )}
          </div>

          {data.meta.channels_total > data.meta.channels_shown && (
            <div className="mb-4 text-neutral-500">
              showing {data.meta.channels_shown} of {data.meta.channels_total}
            </div>
          )}

          {data.channels.map((c) => (
            <div key={c.id} className="mb-4">
              <div>
                - {c.title} (
                {c.blocks.length < c.total
                  ? `${c.blocks.length} of ${c.total}`
                  : c.total}{" "}
                items)
              </div>
              {c.blocks.length === 0 ? (
                <div className="pl-4 text-neutral-500">(no blocks)</div>
              ) : (
                c.blocks.map((b) => (
                  <div key={b.id} className="pl-4">
                    <div>
                      {b.position !== undefined ? `#${b.position} ` : ""}[
                      {b.type}] {b.title}{" "}
                      <span className="text-neutral-500">(id {b.id})</span>
                    </div>
                    {b.source_url && (
                      <div className="pl-4">
                        <a
                          href={b.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 underline break-all"
                        >
                          {b.source_url}
                        </a>
                      </div>
                    )}
                    {b.content && (
                      <div className="pl-4 mt-1 whitespace-pre-wrap text-neutral-700">
                        {b.content}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
