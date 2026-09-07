import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const publicDir = path.resolve("artifacts/bond402/dist/public");
const seoSource = fs.readFileSync(
  path.resolve("artifacts/bond402/src/components/route-seo.tsx"),
  "utf8",
);
const expected = {
  "/security": {
    title: "Bond402 Security & Trust – Beobachtbare API-Signale",
    description:
      "Bond402 beschreibt beobachtbare API-Trust-Signale wie HTTPS, TLS, Header, Uptime und Latenz. ALLOW ist keine Sicherheitsgarantie.",
  },
  "/about": {
    title: "Bond402 – Über die Trust-Schicht für APIs",
    description:
      "Bond402 macht gespeicherte Prüfungen registrierter APIs für Menschen und AI Agents nachvollziehbar. Kein Audit und keine Sicherheitsgarantie.",
  },
  "/impressum": {
    title: "Bond402 Impressum – Betreiber und Kontakt",
    description:
      "Impressum der privaten Bond402 Public Beta mit Betreiberangaben und Kontakt. Bond402 bietet beobachtbare API-Trust-Daten, keine Sicherheitszertifizierung.",
  },
  "/datenschutz": {
    title: "Bond402 Datenschutzerklärung – Datenverarbeitung",
    description:
      "Datenschutzerklärung der Bond402 Public Beta: Konten, API-Keys, Prüfdaten und öffentliche Trust-Metadaten – ohne Wallets oder echte Zahlungen.",
  },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaContent(html, attribute, key) {
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${escapeRegExp(key)}"\\s+content="([^"]*)"`,
    "i",
  );
  const match = html.match(pattern);
  assert.ok(match, `meta ${attribute}=${key}`);
  return decodeHtml(match[1]);
}

function linkHref(html, relation) {
  const match = html.match(new RegExp(`<link\\s+rel="${relation}"\\s+href="([^"]*)"`, "i"));
  assert.ok(match, `link rel=${relation}`);
  return match[1];
}

function routeSchema(html, route) {
  const match = html.match(
    /<script type="application\/ld\+json" data-bond402-route-schema>([\s\S]*?)<\/script>/i,
  );
  assert.ok(match, `${route} route structured data`);
  const schema = JSON.parse(match[1]);
  assert.equal(schema["@context"], "https://schema.org", `${route} schema context`);
  assert.equal(schema["@type"], "WebPage", `${route} schema type`);
  assert.equal(schema.url, `https://bond402.com${route}`, `${route} schema URL`);
  assert.equal(schema.isPartOf.url, "https://bond402.com/", `${route} schema site URL`);
  return schema;
}

test("route-specific SEO shells expose factual public metadata", () => {
  for (const [route, metadata] of Object.entries(expected)) {
    const html = fs.readFileSync(path.join(publicDir, route.slice(1), "index.html"), "utf8");
    assert.match(html, new RegExp(`<title>${metadata.title}</title>`), `${route} title`);
    assert.match(html, new RegExp(metadata.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${route} description`);
    assert.equal(linkHref(html, "canonical"), `https://bond402.com${route}`, `${route} canonical`);
    assert.equal(metaContent(html, "name", "robots"), "index, follow", `${route} robots`);
    assert.equal(metaContent(html, "property", "og:title"), metadata.title, `${route} og:title`);
    assert.equal(metaContent(html, "property", "og:description"), metadata.description, `${route} og:description`);
    assert.equal(metaContent(html, "property", "og:url"), `https://bond402.com${route}`, `${route} og:url`);
    assert.equal(metaContent(html, "property", "og:image"), "/logo.svg", `${route} og:image`);
    assert.equal(metaContent(html, "name", "twitter:title"), metadata.title, `${route} twitter:title`);
    assert.equal(metaContent(html, "name", "twitter:description"), metadata.description, `${route} twitter:description`);
    assert.equal(metaContent(html, "name", "twitter:card"), "summary", `${route} twitter:card`);
    assert.equal(metaContent(html, "name", "twitter:image"), "/logo.svg", `${route} twitter:image`);
    routeSchema(html, route);
    assert.doesNotMatch(html, /security certification|sicherheitszertifiziert/i, `${route} must not overclaim`);
  }
});

test("root SEO metadata and public discovery assets stay consistent", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  assert.equal(linkHref(html, "canonical"), "https://bond402.com/");
  assert.equal(metaContent(html, "name", "robots"), "index, follow");
  assert.equal(metaContent(html, "property", "og:url"), "https://bond402.com/");
  assert.equal(metaContent(html, "property", "og:image"), "/logo.svg");
  assert.equal(metaContent(html, "name", "twitter:card"), "summary_large_image");
  assert.equal(metaContent(html, "name", "twitter:image"), "/logo.svg");
  const rootSchemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  assert.ok(rootSchemas.length >= 1, "root structured data");
  const softwareSchema = JSON.parse(rootSchemas[0][1]);
  assert.equal(softwareSchema["@context"], "https://schema.org");
  assert.equal(softwareSchema["@type"], "SoftwareApplication");
  assert.equal(softwareSchema.url, "https://bond402.com/");

  const robots = fs.readFileSync(path.join(publicDir, "robots.txt"), "utf8");
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/bond402\.com\/sitemap\.xml$/m);
  for (const privateRoute of [
    "/dashboard",
    "/developer",
    "/profile",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
  ]) {
    assert.match(robots, new RegExp(`^Disallow: ${escapeRegExp(privateRoute)}$`, "m"));
  }
  for (const publicRoute of ["/", "/about", "/security", "/catalog"]) {
    assert.doesNotMatch(robots, new RegExp(`^Disallow: ${escapeRegExp(publicRoute)}$`, "m"));
  }

  const llms = fs.readFileSync(path.join(publicDir, "llms.txt"), "utf8");
  for (const url of [
    "https://bond402.com/api/public/discovery",
    "https://bond402.com/api/public/services",
    "https://bond402.com/api/openapi.json",
    "https://bond402.com/api-docs",
    "https://bond402.com/security",
    "https://bond402.com/about",
    "https://bond402.com/impressum",
    "https://bond402.com/datenschutz",
  ]) {
    assert.match(llms, new RegExp(escapeRegExp(url)), `llms.txt URL ${url}`);
  }

  const agent = JSON.parse(
    fs.readFileSync(path.join(publicDir, ".well-known", "bond402-agent.json"), "utf8"),
  );
  assert.equal(agent.catalog, "https://bond402.com/catalog");
  assert.equal(agent.discovery, "https://bond402.com/api/public/discovery");
  assert.equal(agent.openapi, "https://bond402.com/api/openapi.json");
  assert.equal(agent.apiBase, "https://bond402.com/api");
  assert.deepEqual(agent.decisions, ["ALLOW", "CAUTION", "BLOCK"]);
  assert.equal(agent.limits.publicCatalogRequestsPerMinutePerIp, 60);
  assert.match(agent.disclaimer, /ALLOW ist keine Sicherheitsgarantie/i);
});

test("private route SEO policy remains noindex and nofollow", () => {
  for (const privateRoute of [
    "/dashboard",
    "/developer",
    "/profile",
    "/x402-sandbox",
    "/bond-sandbox",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
  ]) {
    assert.match(seoSource, new RegExp(`"${escapeRegExp(privateRoute)}"`), `${privateRoute} is private`);
  }
  assert.match(seoSource, /robots:\s*"noindex, nofollow"/);
  assert.match(seoSource, /setMeta\("name", "robots", metadata\.robots\)/);
});