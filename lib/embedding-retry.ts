const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;

export async function withEmbeddingRetries<T>(
  operation: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    onTransientError?: (err: unknown, attempt: number) => void;
  } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? defaultSleep;
  const onTransientError = opts.onTransientError;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isTransientEmbeddingError(err)) break;
      onTransientError?.(err, attempt);
      await sleep(BASE_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

export function isTransientEmbeddingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const error = err as {
    name?: unknown;
    status?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  if (typeof error.status === "number") {
    if (error.status === 408 || error.status === 409 || error.status === 429) {
      return true;
    }
    if (error.status >= 500) return true;
  }

  if (error.name === "APIConnectionError" || error.name === "APIConnectionTimeoutError") {
    return true;
  }

  if (typeof error.code === "string" && TRANSIENT_CODES.has(error.code)) {
    return true;
  }

  if (typeof error.message === "string" && isTransientMessage(error.message)) {
    return true;
  }

  return isTransientEmbeddingError(error.cause);
}

function isTransientMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("premature close") ||
    normalized.includes("invalid response body") ||
    normalized.includes("fetch failed") ||
    normalized.includes("socket hang up") ||
    normalized.includes("connection reset") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("terminated")
  );
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
