import { useEffect } from "react";
import { useLocation } from "wouter";
import routeSeoPages from "@/lib/route-seo-pages.json";

const SITE_URL = "https://bond402.com";
const DEFAULT_METADATA = {
  title: "Bond402 – Security & Trust für APIs und AI Agents",
  description:
    "Bond402 prüft beobachtbare Trust-Signale von registrierten APIs und stellt AI Agents maschinenlesbare ALLOW-, CAUTION- und BLOCK-Hinweise bereit. ALLOW ist keine Sicherheitsgarantie.",
  keywords: "API Trust, AI Agents, API Security Signals, TLS, Uptime, p95 Latenz, Domain-Verifizierung",
  section: "Bond402",
};
const CATALOG_DETAIL_METADATA = {
  title: "Bond402 Public Trust Catalog – Beobachtbare API-Daten",
  description:
    "Öffentliche Trust-Daten zu ausdrücklich gelisteten APIs: gespeicherte Prüfungen, Status, Uptime und Latenz. ALLOW ist keine Sicherheitsgarantie.",
  keywords: "Bond402 Public Trust Catalog, API Trust Score, Uptime, p95, p99",
  section: "Public Trust Catalog",
};
const PRIVATE_PATHS = new Set([
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
]);

type Metadata = {
  title: string;
  description: string;
  keywords: string;
  section: string;
  robots: "index, follow" | "noindex, nofollow";
};

function getMetadata(location: string): Metadata {
  const path = location.split("?")[0].replace(/\/+$/, "") || "/";
  const page = (routeSeoPages as Record<string, Omit<Metadata, "robots">>)[path];
  if (page) return { ...page, robots: "index, follow" };
  if (path === "/catalog" || path.startsWith("/catalog/")) {
    return { ...CATALOG_DETAIL_METADATA, robots: "index, follow" };
  }
  if (PRIVATE_PATHS.has(path) || path.startsWith("/sign-in/") || path.startsWith("/sign-up/")) {
    return { ...DEFAULT_METADATA, robots: "noindex, nofollow" };
  }
  return { ...DEFAULT_METADATA, robots: "index, follow" };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function setCanonical(path: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }
  element.href = `${SITE_URL}${path === "/" ? "/" : path}`;
}

function setRouteStructuredData(metadata: Metadata, path: string) {
  let element = document.head.querySelector<HTMLScriptElement>("script[data-bond402-route-schema]");
  if (!element) {
    element = document.createElement("script");
    element.type = "application/ld+json";
    element.dataset.bond402RouteSchema = "true";
    document.head.appendChild(element);
  }
  element.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: metadata.title,
    description: metadata.description,
    url: `${SITE_URL}${path === "/" ? "/" : path}`,
    isPartOf: {
      "@type": "WebSite",
      name: "Bond402",
      url: `${SITE_URL}/`,
    },
    about: {
      "@type": "SoftwareApplication",
      name: "Bond402",
      applicationCategory: "DeveloperApplication",
    },
  });
}

export function applyRouteSeo(location: string) {
  const path = location.split("?")[0].replace(/\/+$/, "") || "/";
  const metadata = getMetadata(location);
  document.title = metadata.title;
  setMeta("name", "description", metadata.description);
  setMeta("name", "keywords", metadata.keywords);
  setMeta("name", "robots", metadata.robots);
  setMeta("property", "og:title", metadata.title);
  setMeta("property", "og:description", metadata.description);
  setMeta("property", "og:url", `${SITE_URL}${path === "/" ? "/" : path}`);
  setMeta("property", "og:site_name", "Bond402");
  setMeta("property", "og:type", "website");
  setMeta("name", "twitter:title", metadata.title);
  setMeta("name", "twitter:description", metadata.description);
  setMeta("name", "twitter:card", "summary");
  setCanonical(path);
  setRouteStructuredData(metadata, path);
}

export function RouteSeo() {
  const [location] = useLocation();

  useEffect(() => {
    applyRouteSeo(location);
  }, [location]);

  return null;
}