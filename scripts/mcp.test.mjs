import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test, before, after } from "node:test";

const port = 18_129;
const baseUrl = `http://127.0.0.1:${port}`;
let server;

async function waitForMcp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method: "server/discover" }),
      });
      if (response.status === 200 || response.status === 400) return;
    } catch {
      // The server may still be compiling or binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("MCP-Server wurde nicht rechtzeitig erreichbar.");
}

async function call(body, headers = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}

before(async () => {
  server = spawn("node", ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], {
    env: { ...process.env, PORT: String(port), BASE_PATH: "/" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForMcp();
});

after(async () => {
  if (!server) return;
  server.kill("SIGTERM");
  await once(server, "exit");
});

test("MCP current discovery is stateless and exposes only public tools without auth", async () => {
  const result = await call(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "mcp-test", version: "1.0.0" },
        },
      },
    },
    {
      "MCP-Protocol-Version": "2026-07-28",
      "MCP-Method": "tools/list",
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.data.result.resultType, "complete");
  assert.deepEqual(
    result.data.result.tools.map((tool) => tool.name),
    ["compare_or_decide", "search_services"],
  );
});

test("MCP supports legacy initialize and initialized notification", async () => {
  const initialized = await call({
    jsonrpc: "2.0",
    id: "legacy-init",
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "legacy-test", version: "1.0.0" },
    },
  });
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.data.result.protocolVersion, "2025-03-26");
  assert.equal(initialized.data.result.capabilities.tools.listChanged, false);

  const notification = await call({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });
  assert.equal(notification.response.status, 202);
  assert.equal(notification.data, null);
});

test("MCP accepts legacy initialize metadata and extensions while validating core fields", async () => {
  const legacyInitialize = await call(
    {
      jsonrpc: "2.0",
      id: "legacy-meta-init",
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "legacy-metadata-test", version: "1.0.0" },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2025-11-25",
          "io.modelcontextprotocol/clientInfo": { name: "legacy-metadata-test", version: "1.0.0" },
        },
        "com.example/forwardCompatibleExtension": { enabled: true },
      },
    },
    { "MCP-Protocol-Version": "2025-11-25" },
  );
  assert.equal(legacyInitialize.response.status, 200);
  assert.equal(legacyInitialize.data.result.protocolVersion, "2025-11-25");

  const malformedCore = await call(
    {
      jsonrpc: "2.0",
      id: "legacy-malformed",
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "legacy-metadata-test" },
      },
    },
    { "MCP-Protocol-Version": "2025-11-25" },
  );
  assert.equal(malformedCore.response.status, 400);
  assert.equal(malformedCore.data.error.code, -32602);

  const unsupportedVersion = await call(
    {
      jsonrpc: "2.0",
      id: "unsupported-version",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "legacy-metadata-test", version: "1.0.0" },
      },
    },
    { "MCP-Protocol-Version": "2024-11-05" },
  );
  assert.equal(unsupportedVersion.response.status, 400);
  assert.equal(unsupportedVersion.data.error.data.code, "UNSUPPORTED_PROTOCOL_VERSION");
});

test("MCP accepts standard current-version requests without custom metadata", async () => {
  const currentInitialize = await call(
    {
      jsonrpc: "2.0",
      id: "current-init",
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "standard-client", version: "1.0.0" },
      },
    },
    { "MCP-Protocol-Version": "2026-07-28" },
  );
  assert.equal(currentInitialize.response.status, 200);
  assert.equal(currentInitialize.data.result.protocolVersion, "2026-07-28");

  const currentTools = await call(
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { "MCP-Protocol-Version": "2026-07-28" },
  );
  assert.equal(currentTools.response.status, 200);
  assert.deepEqual(
    currentTools.data.result.tools.map((tool) => tool.name),
    ["compare_or_decide", "search_services"],
  );

  const contradictoryMetadata = await call(
    {
      jsonrpc: "2.0",
      id: "contradictory-metadata",
      method: "tools/list",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2025-06-18" } },
    },
    { "MCP-Protocol-Version": "2026-07-28" },
  );
  assert.equal(contradictoryMetadata.response.status, 400);
  assert.equal(contradictoryMetadata.data.error.data.code, "HEADER_MISMATCH");
});

test("MCP rejects unknown fields, invalid origins and GET transport", async () => {

  const unknownField = await call({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
    params: { unexpected: true },
  });
  assert.equal(unknownField.response.status, 400);
  assert.equal(unknownField.data.error.code, -32602);

  const invalidOrigin = await call(
    { jsonrpc: "2.0", id: 4, method: "server/discover" },
    { Origin: "https://attacker.example" },
  );
  assert.equal(invalidOrigin.response.status, 403);

  const getResponse = await fetch(`${baseUrl}/mcp`, {
    headers: { Accept: "text/event-stream" },
  });
  assert.equal(getResponse.status, 405);
});

test("MCP keeps owner tools hidden without a scoped key", async () => {
  const result = await call({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "execute_plan", arguments: { planId: "00000000-0000-0000-0000-000000000000" } },
  });
  assert.equal(result.response.status, 404);
  assert.equal(result.data.error.data.code, "UNKNOWN_TOOL");
});