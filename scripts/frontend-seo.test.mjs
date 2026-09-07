import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const publicDir = path.resolve("artifacts/bond402/dist/public");
const expected = {
  "/security": {
    title: "Bond402 Security & Trust – Beobachtbare API-Signale",
    description: "ALLOW ist keine Sicherheitsgarantie.",
  },
  "/about": {
    title: "Bond402 – Über die Trust-Schicht für APIs",
    description: "Kein Audit und keine Sicherheitsgarantie.",
  },
  "/impressum": {
    title: "Bond402 Impressum – Betreiber und Kontakt",
    description: "keine Sicherheitszertifizierung.",
  },
  "/datenschutz": {
    title: "Bond402 Datenschutzerklärung – Datenverarbeitung",
    description: "ohne Wallets oder echte Zahlungen.",
  },
};

test("route-specific SEO shells expose factual public metadata", () => {
  for (const [route, metadata] of Object.entries(expected)) {
    const html = fs.readFileSync(path.join(publicDir, route.slice(1), "index.html"), "utf8");
    assert.match(html, new RegExp(`<title>${metadata.title}</title>`), `${route} title`);
    assert.match(html, new RegExp(metadata.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), `${route} description`);
    assert.match(html, new RegExp(`rel="canonical" href="https://bond402\\.com${route}"`), `${route} canonical`);
    assert.match(html, /property="og:url"/, `${route} Open Graph URL`);
    assert.match(html, /data-bond402-route-schema/, `${route} structured data`);
    assert.doesNotMatch(html, /security certification|sicherheitszertifiziert/i, `${route} must not overclaim`);
  }
});