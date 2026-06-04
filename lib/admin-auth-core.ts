import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE_NAME = "semblocks_admin";
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type AdminAuthConfig = {
  password: string | undefined;
  cookieSecret: string | undefined;
};

type SessionPayload = {
  v: 1;
  iat: number;
  exp: number;
};

type TokenOptions = {
  now?: number;
  ttlSeconds?: number;
};

export function getAdminAuthConfig(env: Record<string, string | undefined>): AdminAuthConfig {
  return {
    password: nonEmpty(env.ARESEARCH_ADMIN_PASSWORD),
    cookieSecret: nonEmpty(env.ADMIN_COOKIE_SECRET),
  };
}

export function isAdminAuthConfigured(config: AdminAuthConfig): boolean {
  return Boolean(config.password && config.cookieSecret);
}

export function verifyAdminPassword(
  candidate: string,
  configuredPassword: string | undefined,
): boolean {
  if (!configuredPassword || candidate.length === 0) return false;
  const candidateMac = createHmac("sha256", configuredPassword)
    .update(candidate)
    .digest();
  const configuredMac = createHmac("sha256", configuredPassword)
    .update(configuredPassword)
    .digest();
  return timingSafeEqual(candidateMac, configuredMac);
}

export function createAdminSessionToken(
  secret: string,
  options: TokenOptions = {},
): string {
  if (!secret) throw new Error("Admin cookie secret is required");
  const now = Math.floor(options.now ?? Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds ?? ADMIN_SESSION_TTL_SECONDS;
  if (!Number.isFinite(now) || now < 0) throw new Error("Invalid session time");
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Invalid session TTL");
  }
  const payload: SessionPayload = {
    v: 1,
    iat: now,
    exp: now + Math.floor(ttlSeconds),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyAdminSessionToken(
  token: string | undefined,
  secret: string | undefined,
  options: Pick<TokenOptions, "now"> = {},
): boolean {
  if (!token || !secret) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return false;

  const encodedPayload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!encodedPayload || !signature) return false;

  const expected = sign(encodedPayload, secret);
  if (!constantTimeEqual(signature, expected)) return false;

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return false;
  }
  if (!isSessionPayload(payload)) return false;

  const now = Math.floor(options.now ?? Date.now() / 1000);
  if (payload.iat > now + 60) return false;
  return payload.exp > now;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SessionPayload>;
  return (
    payload.v === 1 &&
    typeof payload.iat === "number" &&
    Number.isInteger(payload.iat) &&
    payload.iat >= 0 &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp) &&
    payload.exp > payload.iat
  );
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return value;
}
