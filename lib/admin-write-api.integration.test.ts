import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_COOKIE_NAME,
  createAdminSessionToken,
} from "./admin-auth-core.ts";

const WRITE_ENDPOINTS = [
  "/api/arena/ingest",
  "/api/embed",
  "/api/ocr",
  "/api/external-content",
  "/api/transcripts",
  "/api/chunks",
  "/api/sync",
  "/api/jobs/ocr",
  "/api/jobs/sync",
  "/api/jobs/test-job-id/cancel",
] as const;

test("admin write APIs reject unauthenticated and tampered cookies", { timeout: 120_000 }, async () => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const secret = "write-api-integration-cookie-secret";
  const server = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: {
      ...process.env,
      ARESEARCH_ADMIN_PASSWORD: "correct horse battery staple",
      ADMIN_COOKIE_SECRET: secret,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  const output: string[] = [];
  server.stdout.on("data", (chunk) => output.push(String(chunk)));
  server.stderr.on("data", (chunk) => output.push(String(chunk)));

  try {
    await waitForServer(`${baseUrl}/dev`, output);

    for (const endpoint of WRITE_ENDPOINTS) {
      const res = await fetch(`${baseUrl}${endpoint}`, { method: "POST" });
      assert.equal(res.status, 401, `${endpoint} should reject missing admin cookie`);
      assert.deepEqual(await res.json(), { error: "Admin required" });

      const tampered = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { cookie: `${ADMIN_COOKIE_NAME}=tampered` },
      });
      assert.equal(tampered.status, 401, `${endpoint} should reject tampered admin cookie`);
      assert.deepEqual(await tampered.json(), { error: "Admin required" });
    }
  } finally {
    await stopServer(server);
  }
});

test("admin write APIs return config error when auth env is missing", { timeout: 120_000 }, async () => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    ARESEARCH_ADMIN_PASSWORD: "",
    ADMIN_COOKIE_SECRET: "",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const server = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], { env });
  const output: string[] = [];
  server.stdout.on("data", (chunk) => output.push(String(chunk)));
  server.stderr.on("data", (chunk) => output.push(String(chunk)));

  try {
    await waitForServer(`${baseUrl}/dev`, output);
    const res = await fetch(`${baseUrl}/api/embed`, { method: "POST" });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "Admin auth is not configured" });
  } finally {
    await stopServer(server);
  }
});

test("valid admin cookie reaches write route validation", { timeout: 120_000 }, async () => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const secret = "write-api-authorized-cookie-secret";
  const server = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: {
      ...process.env,
      ARESEARCH_ADMIN_PASSWORD: "correct horse battery staple",
      ADMIN_COOKIE_SECRET: secret,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  const output: string[] = [];
  server.stdout.on("data", (chunk) => output.push(String(chunk)));
  server.stderr.on("data", (chunk) => output.push(String(chunk)));

  try {
    await waitForServer(`${baseUrl}/dev`, output);
    const token = createAdminSessionToken(secret, { now: Math.floor(Date.now() / 1000) });
    for (const endpoint of ["/api/arena/ingest", "/api/sync", "/api/jobs/sync"] as const) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: { cookie: `${ADMIN_COOKIE_NAME}=${token}` },
      });
      assert.equal(res.status, 400, `${endpoint} should validate missing user`);
      assert.deepEqual(await res.json(), { error: "Missing ?user=" });
    }
  } finally {
    await stopServer(server);
  }
});

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  return port;
}

async function waitForServer(url: string, output: string[]) {
  const deadline = Date.now() + 60_000;
  let lastError = "not started";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = `${res.status} ${await res.text()}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next dev server did not start: ${lastError}\n${output.join("")}`);
}

async function stopServer(server: ChildProcessWithoutNullStreams) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (server.exitCode === null && server.signalCode === null) {
        server.kill("SIGKILL");
      }
      resolve();
    }, 5_000);
  });
  await Promise.race([once(server, "exit").then(() => undefined), timeout]);
}
