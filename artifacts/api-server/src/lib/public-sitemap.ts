import { asc, eq } from "drizzle-orm";
import { apiServicesTable, db } from "@workspace/db";

type PublicRequest = {
  protocol: string;
  get(name: string): string | undefined;
};

const STATIC_PUBLIC_PAGES = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/about", changefreq: "monthly", priority: "0.8" },
  { path: "/security", changefreq: "monthly", priority: "0.9" },
  { path: "/catalog", changefreq: "daily", priority: "0.8" },
  { path: "/api-docs", changefreq: "monthly", priority: "0.8" },
  { path: "/status", changefreq: "daily", priority: "0.6" },
  { path: "/impressum", changefreq: "yearly", priority: "0.4" },
  { path: "/datenschutz", changefreq: "yearly", priority: "0.4" },
] as const;

export function publicBaseUrl(req: PublicRequest) {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return "https://bond402.com";
  return `${req.protocol}://${req.get("host") || "localhost"}`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function absolutePublicUrl(baseUrl: string, path: string) {
  return new URL(path, `${baseUrl}/`).toString();
}

function renderUrlEntry(url: string, changefreq: string, priority: string) {
  return [
    "  <url>",
    `    <loc>${escapeXml(url)}</loc>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

export async function renderPublicSitemap(baseUrl: string) {
  const listedServices = await db
    .select({ id: apiServicesTable.id })
    .from(apiServicesTable)
    .where(eq(apiServicesTable.visibility, "LISTED"))
    .orderBy(asc(apiServicesTable.id));

  const entries = STATIC_PUBLIC_PAGES.map((page) =>
    renderUrlEntry(absolutePublicUrl(baseUrl, page.path), page.changefreq, page.priority),
  );

  for (const service of listedServices) {
    entries.push(
      renderUrlEntry(
        absolutePublicUrl(baseUrl, `/catalog/${encodeURIComponent(service.id)}`),
        "weekly",
        "0.7",
      ),
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
}