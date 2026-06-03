"use client";

import { useRef, useState } from "react";
import { Image as ImageIcon } from "@phosphor-icons/react/dist/ssr";
import Button from "@/components/Button";
import { Panel } from "@/components/dashboard/panel";
import { QUERY_IMAGE_MAX_BYTES } from "@/lib/query-image-limits";
import { cn } from "@/lib/utils";
import type {
  RecommendationState,
  RecResponse,
} from "../recommendations/types";

type RecQueryInputCardProps = {
  className?: string;
  onStateChange?: (state: RecommendationState) => void;
};

const PLACEHOLDER = "Enter text to get recommended channels";

export function RecQueryInputCard({
  className,
  onStateChange,
}: RecQueryInputCardProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const hasText = text.trim().length > 0;

  async function recommendFromText(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    await runRecommendation("text", { text: trimmed });
  }

  function submitOnEnter(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;

    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }

  async function recommendFromImage(file: File) {
    if (busy) return;
    if (!file.type.startsWith("image/")) {
      const msg = "Please pick an image file.";
      setError(msg);
      onStateChange?.({ status: "error", source: "image", error: msg });
      return;
    }
    if (file.size > QUERY_IMAGE_MAX_BYTES) {
      const mb = (QUERY_IMAGE_MAX_BYTES / (1024 * 1024)).toFixed(0);
      const msg = `Image too large (max ${mb} MB).`;
      setError(msg);
      onStateChange?.({ status: "error", source: "image", error: msg });
      return;
    }
    const image_data_url = await readFileAsDataUrl(file);
    await runRecommendation("image", { image_data_url });
  }

  async function runRecommendation(
    source: "text" | "image",
    body: { text: string } | { image_data_url: string },
  ) {
    setBusy(true);
    setError(null);
    onStateChange?.({ status: "loading", source });
    try {
      const res = await fetch("/api/recommend-channel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const response = (await res.json()) as RecResponse | { error: string };
      if (!res.ok || "error" in response) {
        const msg = "error" in response ? response.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      onStateChange?.({ status: "ready", source, result: response });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      onStateChange?.({ status: "error", source, error: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={cn("flex min-w-0 flex-col px-6 py-4", className)}>
      <form onSubmit={recommendFromText} className="flex h-full min-w-0 flex-col gap-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          disabled={busy}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          enterKeyHint="search"
          onKeyDown={submitOnEnter}
          className="min-h-0 flex-1 resize-none bg-transparent text-base leading-6 text-neutral-800 outline-none placeholder:text-black/50 disabled:opacity-60"
        />
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Button
            type="button"
            aria-label="Recommend channels from image"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="flex h-9 w-9 items-center justify-center px-0 py-0"
          >
            <ImageIcon size={26} />
          </Button>
          <Button
            type="submit"
            disabled={busy || !hasText}
            className="h-9 px-4 py-0"
          >
            {busy ? "…" : "Recommend"}
          </Button>
        </div>
        {error ? <p className="text-sm leading-5 text-error">{error}</p> : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void recommendFromImage(file);
          }}
        />
      </form>
    </Panel>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader produced non-string result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
