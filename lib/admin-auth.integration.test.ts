import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_COOKIE_NAME,
  verifyAdminSessionToken,
} from "./admin-auth-core.ts";

test("/dev login sets a signed httpOnly admin cookie", { timeout: 120_000 }, async () => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    detached: true,
    env: {
      ...process.env,
      ARESEARCH_ADMIN_PASSWORD: "correct horse battery staple",
      ADMIN_COOKIE_SECRET: "integration-test-cookie-secret",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });

  const output: string[] = [];
  server.stdout.on("data", (chunk) => output.push(String(chunk)));
  server.stderr.on("data", (chunk) => output.push(String(chunk)));

  try {
    await waitForServer(`${baseUrl}/dev`, output);

    const publicDev = await fetch(`${baseUrl}/dev`);
    assert.equal(publicDev.status, 200);
    const publicHtml = await publicDev.text();
    assert.match(publicHtml, /Owner mode/);
    assert.match(publicHtml, /type="password"/);
    assert.doesNotMatch(publicHtml, /Log out/);

    const invalid = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "wrong" }),
    });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.headers.get("set-cookie"), null);

    const validJson = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });
    assert.equal(validJson.status, 200);
    assert.deepEqual(await validJson.json(), { ok: true });
    const jsonSetCookie = validJson.headers.get("set-cookie");
    assert.ok(jsonSetCookie);
    assert.match(jsonSetCookie, new RegExp(`${ADMIN_COOKIE_NAME}=`));
    assert.match(jsonSetCookie, /HttpOnly/i);
    assert.match(jsonSetCookie, /SameSite=Lax/i);
    assert.match(jsonSetCookie, /Path=\//i);
    assert.match(jsonSetCookie, /Max-Age=604800/i);
    const adminCookie = extractCookie(jsonSetCookie, ADMIN_COOKIE_NAME);
    assert.equal(
      verifyAdminSessionToken(
        adminCookie,
        "integration-test-cookie-secret",
      ),
      true,
    );

    const privateDev = await fetch(`${baseUrl}/dev`, {
      headers: { cookie: `${ADMIN_COOKIE_NAME}=${adminCookie}` },
    });
    assert.equal(privateDev.status, 200);
    const privateHtml = await privateDev.text();
    assert.match(privateHtml, /Log out/);
    assert.match(privateHtml, /aresearch/);

    const tamperedDev = await fetch(`${baseUrl}/dev`, {
      headers: { cookie: `${ADMIN_COOKIE_NAME}=${adminCookie}x` },
    });
    assert.equal(tamperedDev.status, 200);
    const tamperedHtml = await tamperedDev.text();
    assert.match(tamperedHtml, /Owner mode/);
    assert.doesNotMatch(tamperedHtml, /Log out/);

    const validForm = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "correct horse battery staple" }),
    });
    assert.equal(validForm.status, 303);
    assert.equal(new URL(requireHeader(validForm, "location")).pathname, "/dev");
    assert.ok(validForm.headers.get("set-cookie")?.includes(ADMIN_COOKIE_NAME));

    const logout = await fetch(`${baseUrl}/api/admin/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: `${ADMIN_COOKIE_NAME}=${adminCookie}` },
    });
    assert.equal(logout.status, 303);
    const logoutCookie = logout.headers.get("set-cookie");
    assert.ok(logoutCookie);
    assert.match(logoutCookie, new RegExp(`${ADMIN_COOKIE_NAME}=`));
    assert.match(logoutCookie, /Max-Age=0/i);
  } finally {
    await stopServer(server);
  }
});

function extractCookie(setCookie: string, name: string): string {
  const prefix = `${name}=`;
  const part = setCookie
    .split(";")
    .find((piece) => piece.trimStart().startsWith(prefix));
  assert.ok(part, `Missing ${name} cookie in ${setCookie}`);
  return part.trimStart().slice(prefix.length);
}

function requireHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  assert.ok(value, `Missing ${name} header`);
  return value;
}

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.close((err) => (err ? reject(err) : resolve()));
  await promise;
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
    await delay(250);
  }
  throw new Error(`Next dev server did not start: ${lastError}\n${output.join("")}`);
}

async function stopServer(server: ChildProcessWithoutNullStreams) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const pid = server.pid;
  if (pid) {
    process.kill(-pid, "SIGTERM");
  } else {
    server.kill("SIGTERM");
  }
  const timeout = delay(5_000).then(() => {
    if (server.exitCode === null && server.signalCode === null) {
      if (pid) {
        process.kill(-pid, "SIGKILL");
      } else {
        server.kill("SIGKILL");
      }
    }
  });
  await Promise.race([once(server, "exit").then(() => undefined), timeout]);
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
