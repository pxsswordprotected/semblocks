export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type JobType = "ocr" | "sync_full";
export type JobEventLevel = "info" | "warn" | "error";

export type JobRow = {
  id: string;
  job_type: JobType | string;
  status: JobStatus;
  progress_current: number;
  progress_total: number | null;
  message: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
  cancel_requested_at: string | null;
  dedupe_key: string | null;
  worker_id: string | null;
};

export type JobEventRow = {
  id: number;
  job_id: string;
  ts: string;
  level: JobEventLevel;
  event_type: string;
  message: string | null;
  data_json: string | null;
};

export type JobProgress = {
  total: number;
  completed: number;
  processed: number;
  errors: number;
  skipped: number;
};
