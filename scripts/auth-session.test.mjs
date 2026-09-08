import assert from "node:assert/strict";
import { test } from "node:test";

const { fetchCurrentAuthUser, INITIAL_AUTH_CHECK_TIMEOUT_MS } = await import(
  "../artifacts/bond402/src/lib/auth-session.ts"
);

test("initial auth check treats an unauthenticated response as anonymous", async () => {
  let receivedInit;
  const user = await fetchCurrentAuthUser(async (_url, init) => {
    receivedInit = init;
    return new Response(JSON.stringify({ error: "Nicht angemeldet." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  });

  assert.equal(user, null);
  assert.equal(receivedInit.credentials, "same-origin");
  assert.ok(receivedInit.signal instanceof AbortSignal);
});

test("initial auth check aborts a hanging request and fails open as anonymous", async () => {
  let aborted = false;
  const startedAt = Date.now();
  const user = await fetchCurrentAuthUser(
    async (_url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    20,
  );

  assert.equal(user, null);
  assert.equal(aborted, true);
  assert.ok(Date.now() - startedAt < INITIAL_AUTH_CHECK_TIMEOUT_MS);
});