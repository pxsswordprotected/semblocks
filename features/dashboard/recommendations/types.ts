export type RecTopBlock = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  arena_url: string | null;
  vec_distance: number;
};

export type RecChannel = {
  channel_id: number;
  channel_title: string | null;
  channel_url: string | null;
  raw_score: number;
  score: number;
  channel_size: number;
  block_count: number;
  top_blocks: RecTopBlock[];
};

export type RecRelatedBlock = {
  block_id: number;
  arena_block_id: number;
  title: string | null;
  block_type: string | null;
  arena_url: string | null;
  channel_title: string | null;
  channel_url: string | null;
  vec_distance: number;
};

export type RecCaptionMeta = {
  ocr_text: string;
  ocr_summary: string | null;
};

export type RecResponse = {
  input_chars: number;
  channels: RecChannel[];
  related_blocks: RecRelatedBlock[];
  // Present for image-sourced recommendations: the caption text used to
  // search, so the UI can show/edit exactly what was queried.
  query?: string;
  caption_meta?: RecCaptionMeta;
};

export type RecommendationState =
  | { status: "idle" }
  | { status: "loading"; source: "text" | "image" }
  | { status: "error"; source: "text" | "image"; error: string }
  | { status: "ready"; source: "text" | "image"; result: RecResponse };
