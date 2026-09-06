import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { test, before, after } from "node:test";

const port = Number(process.env.BOND402_WEB_TEST_PORT || 15173);
const baseUrl = process.env.BOND402_WEB_URL || `http://127.0.0.1:${port}`;
let server;

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      // Vite may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Die Bond402-Webanwendung wurde nicht rechtzeitig erreichbar.");
}

before(async () => {
  if (process.env.BOND402_WEB_URL) {
    await waitForServer();
    return;
  }
  server = spawn(
    "pnpm",
    ["--filter", "@workspace/bond402", "run", "dev", "--", "--port", String(port)],
    {
      env: {
        ...process.env,
        PORT: String(port),
        BASE_PATH: "/",
        BOND402_API_BASE_URL: "/api",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stderr.on("data", (chunk) => process.stderr.write(`[frontend-smoke] ${chunk}`));
  await waitForServer();
});

after(async () => {
  if (server && !server.killed) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
});

test("öffentliche SPA-Routen bleiben direkt erreichbar", async () => {
  const routes = [
    "/",
    "/api-docs",
    "/status",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/sign-in",
    "/sign-up",
    "/impressum",
    "/datenschutz",
    "/about",
    "/security",
    "/catalog",
    "/dashboard",
    "/developer",
    "/profile",
    "/x402-sandbox",
    "/bond-sandbox",
  ];

  for (const route of routes) {
    const response = await fetch(`${baseUrl}${route}`);
    const html = await response.text();
    assert.equal(response.status, 200, `${route} muss HTML liefern`);
    assert.match(html, /Bond402/i, `${route} muss die Bond402-App laden`);
  }

  const docs = await (await fetch(`${baseUrl}/api-docs`)).text();
  assert.match(docs, /Bond402/i);
});