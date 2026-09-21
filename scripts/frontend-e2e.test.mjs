import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { chromium } from "playwright-core";

const port = Number(process.env.BOND402_E2E_PORT || 15176);
const baseUrl = process.env.BOND402_E2E_URL || `http://127.0.0.1:${port}`;
const chromiumCandidates = [
  process.env.BOND402_CHROMIUM_PATH,
  "/repl/tools/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter(Boolean);
const chromiumPath = chromiumCandidates.find((candidate) => existsSync(candidate));

const user = {
  id: "fixture-user",
  email: "e2e@example.test",
  name: "E2E Nutzer",
  createdAt: "2026-09-13T00:00:00.000Z",
  emailVerified: true,
};

const internalService = {
  id: "internal-weather",
  name: "Interne Wetter API",
  url: "https://weather.internal.example.test/data",
  expectedStructure: "",
  responseMode: "HTTP",
  maxResponseTime: 1000,
  requestMethod: "GET",
  targetAuthType: "NONE",
  targetAuthHeaderName: null,
  targetAuthSecretConfigured: false,
  requestBody: null,
  domainRelationship: "NOT_EVALUATED",
  visibility: "PRIVATE",
  listedAt: null,
  createdAt: "2026-09-13T00:00:00.000Z",
  securityStatus: "SANDBOX_PENDING",
  firstSeenAt: "2026-09-13T00:00:00.000Z",
  sandboxObservedAt: null,
  trustScore: null,
  trustExplanation: "Noch keine ausreichenden Beobachtungen.",
  availabilityScore: null,
  securityConfidence: "UNKNOWN",
  trustMetrics: {
    regionalAggregation: {
      state: "INSUFFICIENT_REGIONAL_DATA",
      regionCount: 0,
      regions: [],
      liveCheckCount: 0,
      evaluatedCheckCount: 0,
      unassignedLiveCheckCount: 0,
      regionalResults: [],
      contradictorySignals: [],
      observationBasis: "STORED_LIVE_CHECKS",
      continuousMonitoring: false,
      description: "Keine ausreichenden gespeicherten Beobachtungen.",
    },
    sampleCount: 0,
    timedSampleCount: 0,
    uptimePercent: null,
    averageResponseTimeMs: null,
    p95ResponseTimeMs: null,
    p99ResponseTimeMs: null,
    withinTargetPercent: null,
    windowStartAt: null,
    latestCheckAt: null,
    weighting: { method: "fixture", halfLifeDays: 30, description: "Nur Testdaten." },
  },
  signals: { https: "NOT_EVALUATED", tls: "NOT_EVALUATED", securityHeaders: "NOT_EVALUATED" },
  domainVerification: { status: "NOT_STARTED", verifiedAt: null },
  checks: [],
};

const externalService = {
  id: "external:fixture-weather",
  kind: "EXTERNAL_DISCOVERY",
  name: "Externe Wetter API",
  description: "Synthetischer externer Treffer für den Browser-Test.",
  url: "https://api.example.test/weather",
  verification: {
    status: "UNVERIFIED_EXTERNAL",
    reason: "SOURCE_METADATA_ONLY_NO_BOND402_CHECK",
  },
  discovery: {
    source: "APIS_GURU_OPENAPI_DIRECTORY",
    sourceLabel: "APIs.guru OpenAPI-Verzeichnis",
    scope: "PUBLIC_UNVERIFIED_OPENAPI",
    verification: "UNVERIFIED_EXTERNAL",
    matchScore: 94,
    rankingFactors: { textRelevance: 1, sourceFreshness: 1, openApiMetadata: 1 },
    evidence: {
      provider: "fixture.example",
      sourceRecordUrl: "https://catalog.example.test/fixture-weather",
      specificationUrl: "https://catalog.example.test/fixture-weather/openapi.json",
      openapiVersion: "3.0.3",
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
  },
  links: {
    detail: "/catalog/external%3Afixture-weather",
    sourceRecord: "https://catalog.example.test/fixture-weather",
    specification: "https://catalog.example.test/fixture-weather/openapi.json",
  },
};

const externalDetail = {
  id: externalService.id,
  kind: "EXTERNAL_DISCOVERY_DETAIL",
  name: externalService.name,
  provider: "fixture.example",
  version: "1.0.0",
  description: externalService.description,
  source: {
    id: "APIS_GURU_OPENAPI_DIRECTORY",
    label: "APIs.guru OpenAPI-Verzeichnis",
    catalogUrl: "https://api.apis.guru/v2/list.json",
    recordUrl: externalService.links.sourceRecord,
    specificationUrl: externalService.links.specification,
  },
  verification: {
    status: "UNVERIFIED_EXTERNAL",
    reason: "SPECIFICATION_METADATA_ONLY_NO_BOND402_CHECK",
  },
  specification: {
    status: "PARSED",
    openapiVersion: "3.0.3",
    title: externalService.name,
    description: externalService.description,
    servers: [{ url: "https://api.example.test", description: "Fixture server", templated: false }],
    auth: { status: "NOT_REQUIRED", schemes: [] },
    endpoints: [{
      method: "GET",
      path: "/weather",
      summary: "Read weather",
      operationId: "getWeather",
      auth: "NOT_REQUIRED",
      safeToProbe: true,
      reason: "EXPLICITLY_PUBLIC_PARAMETER_FREE_READ",
    }],
  },
  safeEndpoint: {
    method: "GET",
    path: "/weather",
    url: externalService.url,
    reason: "EXPLICITLY_PUBLIC_PARAMETER_FREE_READ",
  },
  safeEndpoints: [{
    method: "GET",
    path: "/weather",
    url: externalService.url,
    reason: "EXPLICITLY_PUBLIC_PARAMETER_FREE_READ",
  }],
  safeEndpointNote: "Nur der explizit öffentliche, parameterfreie GET-Endpunkt ist für den Test auswählbar.",
};

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

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

test("lokaler Browser-Flow deckt Auth, Discovery, Import, Logout und responsive Layout ab", async () => {
  const server = spawn(
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
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  server.stderr.on("data", (chunk) => process.stderr.write(`[frontend-e2e] ${chunk}`));
  let browser;
  let loggedIn = false;
  let created = false;
  let registerPayload = null;
  let publicSearchRequests = 0;
  let apiKeys = [];

  try {
    await waitForServer();
    if (!chromiumPath) {
      throw new Error(
        "Kein Chromium/Chrome gefunden. Für den lokalen Browser-E2E-Test BOND402_CHROMIUM_PATH setzen; der CI-Runner braucht eine verwaltete Browserinstallation.",
      );
    }
    browser = await chromium.launch({
      executablePath: chromiumPath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;

      if (path === "/api/auth/me") {
        return loggedIn ? json(route, { user }) : json(route, { error: "Nicht angemeldet." }, 401);
      }
      if (path === "/api/auth/register" && request.method() === "POST") {
        return json(route, { user, verificationRequired: true, message: "Bitte E-Mail bestätigen." }, 201);
      }
      if (path === "/api/auth/login" && request.method() === "POST") {
        loggedIn = true;
        return json(route, { user });
      }
      if (path === "/api/auth/logout" && request.method() === "POST") {
        loggedIn = false;
        return route.fulfill({ status: 204, body: "" });
      }
      if (path === "/api/api-keys" && request.method() === "GET") {
        return json(route, apiKeys);
      }
      if (path === "/api/api-keys" && request.method() === "POST") {
        const payload = JSON.parse(request.postData() || "{}");
        const id = `mcp-key-${apiKeys.length + 1}`;
        const scopes = payload.scopes || ["read", "plan", "execute", "audit"];
        const key = {
          id,
          name: payload.name,
          prefix: "b402_e2e123…",
          scopes,
          createdAt: "2026-09-21T12:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
        };
        apiKeys = [...apiKeys, key];
        return json(route, { ...key, secret: "b402_e2e-secret-only-once" }, 201);
      }
      if (path.startsWith("/api/api-keys/") && request.method() === "DELETE") {
        const id = path.split("/").pop();
        apiKeys = apiKeys.map((key) => key.id === id
          ? { ...key, revokedAt: "2026-09-21T12:05:00.000Z" }
          : key);
        return route.fulfill({ status: 204, body: "" });
      }
      if (path === "/api/demo-services" && request.method() === "GET") {
        return json(route, []);
      }
      if (path === "/api/services" && request.method() === "GET") {
        return json(route, created ? [internalService, { ...internalService, id: "created-external", name: "Externe Wetter API", url: externalService.url }] : [internalService]);
      }
      if (path === "/api/services" && request.method() === "POST") {
        registerPayload = JSON.parse(request.postData() || "{}");
        created = true;
        return json(route, { ...internalService, id: "created-external", name: registerPayload.name, url: registerPayload.url }, 201);
      }
      if (path === "/api/dashboard") {
        return json(route, {
          serviceCount: created ? 2 : 1,
          checkCount: 0,
          passRate: 0,
          averageResponseTimeMs: 0,
          uptimePercent: null,
          p95ResponseTimeMs: null,
          p99ResponseTimeMs: null,
          timedSampleCount: 0,
        });
      }
      if (path === "/api/usage") {
        return json(route, {
          plan: "FREE",
          planName: "Public Beta",
          monthlyLimit: 10,
          usedChecks: 0,
          remainingChecks: 10,
          periodStart: "2026-09-01T00:00:00.000Z",
          resetAt: "2026-10-01T00:00:00.000Z",
          upgradeAvailable: false,
          priceChf: 0,
          description: "Lokales Testkontingent.",
          availablePlans: [{ plan: "FREE", planName: "Public Beta", monthlyLimit: 10, priceChf: 0, description: "Lokal" }],
        });
      }
      if (path === "/api/public/services" && request.method() === "GET") {
        publicSearchRequests += 1;
        const query = url.searchParams.get("q") || "";
        return json(route, {
          items: query ? [externalService] : [],
          query,
          page: 1,
          pageSize: 8,
          total: query ? 1 : 0,
          hasNextPage: false,
          sort: "matchScore.desc",
          source: {
            source: "APIS_GURU_OPENAPI_DIRECTORY",
            sourceLabel: "APIs.guru OpenAPI-Verzeichnis",
            scope: "PUBLIC_UNVERIFIED_OPENAPI",
            externalSources: true,
            mode: "EXTERNAL_FALLBACK",
            fallback: "USED",
            sourceUrl: "https://api.apis.guru/v2/list.json",
          },
        });
      }
      if (path === `/api/public/services/${encodeURIComponent(externalService.id)}`) {
        return json(route, externalDetail);
      }
      return json(route, {});
    });

    await page.goto(`${baseUrl}/sign-up`);
    await page.locator("#auth-name").fill("E2E Nutzer");
    await page.locator("#auth-email").fill(user.email);
    await page.locator("#auth-password").fill("synthetic-password");
    await page.getByRole("button", { name: "Kostenlos registrieren" }).click();
    await page.getByRole("heading", { name: "Bestätigungs-E-Mail erneut senden" }).waitFor();

    await page.goto(`${baseUrl}/sign-in`);
    await page.locator("#auth-email").fill(user.email);
    await page.locator("#auth-password").fill("synthetic-password");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.getByRole("heading", { name: "Trust Firewall for AI Agents" }).waitFor();
    await page.getByRole("heading", { name: "Interne Wetter API" }).first().waitFor();

    await page.goto(`${baseUrl}/profile`);
    await page.getByRole("link", { name: "API-Schlüssel verwalten" }).click();
    await page.getByRole("heading", { name: "Agent & MCP Access" }).waitFor();
    await page.getByTestId("text-mcp-endpoint").waitFor();
    assert.match(await page.getByTestId("text-mcp-endpoint").textContent(), /\/mcp$/);
    await page.getByTestId("button-create-mcp-access").click();
    await page.getByTestId("input-mcp-access-name").fill("E2E MCP Read Plan");
    await page.getByTestId("button-submit-mcp-access").click();
    await page.getByTestId("input-new-mcp-secret").waitFor();
    assert.equal(await page.getByTestId("input-new-mcp-secret").inputValue(), "b402_e2e-secret-only-once");
    await page.getByTestId("checkbox-acknowledge-mcp-secret").check();
    await page.getByTestId("button-dismiss-mcp-secret").click();
    await page.reload();
    await page.getByRole("heading", { name: "Agent & MCP Access" }).waitFor();
    assert.equal(await page.getByTestId("input-new-mcp-secret").count(), 0);
    assert.equal(await page.getByTestId("text-mcp-access-prefix-mcp-key-1").textContent(), "b402_e2e123…••••••••");
    assert.equal(await page.getByTestId("scope-pill-execute").count(), 0);

    await page.goto(`${baseUrl}/dashboard`);
    await page.getByRole("heading", { name: "Trust Firewall for AI Agents" }).waitFor();
    const search = page.getByRole("textbox", { name: "Registrierte und öffentliche Dienste durchsuchen" });
    await search.fill("Externe Wetter API");
    await page.getByText("UNVERIFIED_EXTERNAL").waitFor();
    assert.ok(publicSearchRequests > 0, "die öffentliche Fallback-Suche muss angefragt werden");
    await page.getByRole("link", { name: "Externe Wetter API: Bond402-Detail öffnen" }).click();
    await page.getByText("UNVERIFIED_EXTERNAL").waitFor();
    await page.getByRole("link", { name: "Zu meinen Diensten hinzufügen" }).click();
    await page.getByRole("heading", { name: "Neuen Dienst registrieren" }).waitFor();
    await page.getByRole("button", { name: "Dienst registrieren" }).click();
    await page.getByText("Dienst erfolgreich hinzugefügt.").waitFor();
    assert.equal(registerPayload.sourceType, "EXTERNAL_DISCOVERY");
    assert.equal(registerPayload.targetAuthType, "NONE");
    assert.equal(registerPayload.url, externalService.url);

    await page.getByRole("button", { name: "Abmelden" }).click();
    await page.getByRole("link", { name: "Anmelden" }).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/sign-in`);
    await page.locator("#auth-email").fill(user.email);
    await page.locator("#auth-password").fill("synthetic-password");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await page.getByRole("heading", { name: "Trust Firewall for AI Agents" }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile darf nicht horizontal überlaufen");
  } finally {
    await browser?.close();
    try {
      process.kill(-server.pid, "SIGINT");
    } catch {
      server.kill("SIGINT");
    }
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
});