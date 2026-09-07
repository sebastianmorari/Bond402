import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(scriptDir, "dist", "public");
const templatePath = path.join(publicDir, "index.html");
const metadataPath = path.join(scriptDir, "src", "lib", "route-seo-pages.json");
const template = fs.readFileSync(templatePath, "utf8");
const pages = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const siteUrl = "https://bond402.com";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setTag(html, pattern, tag) {
  const expression = new RegExp(pattern, "i");
  return expression.test(html) ? html.replace(expression, tag) : html.replace("</head>", `    ${tag}\n  </head>`);
}

function setMeta(html, attribute, key, content) {
  const escapedKey = escapeRegExp(key);
  const pattern = `<meta\\s+${attribute}=["']${escapedKey}["'][^>]*>`;
  return setTag(html, pattern, `<meta ${attribute}="${key}" content="${escapeAttribute(content)}" />`);
}

function routeSchema(metadata, url) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: metadata.title,
    description: metadata.description,
    url,
    isPartOf: { "@type": "WebSite", name: "Bond402", url: `${siteUrl}/` },
    about: { "@type": "SoftwareApplication", name: "Bond402", applicationCategory: "DeveloperApplication" },
  }).replace(/</g, "\\u003c");
}

for (const [route, metadata] of Object.entries(pages)) {
  const url = `${siteUrl}${route}`;
  let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${metadata.title}</title>`);
  html = setMeta(html, "name", "description", metadata.description);
  html = setMeta(html, "name", "keywords", metadata.keywords);
  html = setMeta(html, "name", "robots", "index, follow");
  html = setMeta(html, "property", "og:title", metadata.title);
  html = setMeta(html, "property", "og:description", metadata.description);
  html = setMeta(html, "property", "og:url", url);
  html = setMeta(html, "property", "og:site_name", "Bond402");
  html = setMeta(html, "property", "og:type", "website");
  html = setMeta(html, "name", "twitter:title", metadata.title);
  html = setMeta(html, "name", "twitter:description", metadata.description);
  html = setMeta(html, "name", "twitter:card", "summary");
  html = setTag(html, "<link\\s+rel=[\"']canonical[\"'][^>]*>", `<link rel="canonical" href="${url}" />`);
  html = setTag(
    html,
    "<script\\s+type=[\"']application/ld\\+json[\"'][^>]*>[\\s\\S]*?</script>",
    `<script type="application/ld+json">${template.match(/<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/i)?.[0]?.replace(/^[\s\S]*?>/, "").replace(/<\/script>[\s\S]*$/, "") ?? ""}</script>\n    <script type="application/ld+json" data-bond402-route-schema>${routeSchema(metadata, url)}</script>`,
  );
  const outputDir = path.join(publicDir, route.slice(1));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "index.html"), html);
}