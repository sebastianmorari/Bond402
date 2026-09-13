export const PUBLIC_EXTERNAL_DISCOVERY_SOURCE = "APIS_GURU_OPENAPI_DIRECTORY" as const;
export const PUBLIC_EXTERNAL_DISCOVERY_SOURCE_LABEL = "APIs.guru OpenAPI-Verzeichnis" as const;
export const PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL = "https://api.apis.guru/v2/list.json" as const;
export const PUBLIC_EXTERNAL_DISCOVERY_SCOPE = "PUBLIC_UNVERIFIED_OPENAPI" as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;

export type ExternalApiRecord = {
  id: string;
  provider: string;
  version: string;
  name: string;
  description: string | null;
  categories: string[];
  openapiVersion: string | null;
  updatedAt: string | null;
  specificationUrl: string;
  sourceRecordUrl: string;
};

export type ExternalDiscoveryMetadata = {
  source: typeof PUBLIC_EXTERNAL_DISCOVERY_SOURCE;
  sourceLabel: typeof PUBLIC_EXTERNAL_DISCOVERY_SOURCE_LABEL;
  scope: typeof PUBLIC_EXTERNAL_DISCOVERY_SCOPE;
  verification: "UNVERIFIED_EXTERNAL";
  matchScore: number;
  rankingFactors: {
    textRelevance: number;
    sourceFreshness: number;
    openApiMetadata: number;
  };
  evidence: {
    provider: string;
    sourceRecordUrl: string;
    specificationUrl: string;
    openapiVersion: string | null;
    updatedAt: string | null;
  };
};

export type ExternalDiscoveryItem = {
  id: string;
  kind: "EXTERNAL_DISCOVERY";
  name: string;
  description: string | null;
  url: string;
  verification: {
    status: "UNVERIFIED_EXTERNAL";
    reason: "SOURCE_METADATA_ONLY_NO_BOND402_CHECK";
  };
  discovery: ExternalDiscoveryMetadata;
  links: {
    sourceRecord: string;
    specification: string;
  };
};

export type ExternalDiscoveryLoadResult = {
  status: "AVAILABLE" | "UNAVAILABLE";
  records: ExternalApiRecord[];
};

type ExternalFetch = (input: string, init?: RequestInit) => Promise<Response>;

let cachedRecords: { expiresAt: number; records: ExternalApiRecord[] } | null = null;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function safeString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const sanitized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return sanitized ? sanitized.slice(0, maxLength) : null;
}

function safeHttpsUrl(value: unknown) {
  const candidate = safeString(value, 2_000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function validDate(value: unknown) {
  const candidate = safeString(value, 64);
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return null;
  return candidate;
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function tokens(value: string) {
  return normalize(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function compareStrings(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function textRelevance(record: ExternalApiRecord, query: string) {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) return 0;

  const normalizedName = normalize(record.name);
  const queryTokens = tokens(normalizedQuery);
  const searchableText = normalize(
    [record.name, record.provider, record.description, ...record.categories].filter(Boolean).join(" "),
  );
  const matchingTokens = queryTokens.filter((token) => searchableText.includes(token));

  if (normalizedName === normalizedQuery) return 1;
  if (normalizedName.startsWith(normalizedQuery)) return 0.92;
  if (queryTokens.length > 0 && queryTokens.every((token) => normalizedName.includes(token))) return 0.82;
  if (queryTokens.length > 0 && matchingTokens.length === queryTokens.length) return 0.68;
  if (matchingTokens.length > 0) return 0.35 * (matchingTokens.length / queryTokens.length);
  return 0;
}

function sourceFreshness(record: ExternalApiRecord, now: number) {
  if (!record.updatedAt) return 0;
  const timestamp = Date.parse(record.updatedAt);
  if (!Number.isFinite(timestamp)) return 0;
  const age = Math.max(0, now - timestamp);
  if (age <= DAY_MS) return 1;
  if (age <= 7 * DAY_MS) return 0.75;
  if (age <= 30 * DAY_MS) return 0.5;
  if (age <= 365 * DAY_MS) return 0.25;
  return 0.1;
}

function openApiMetadata(record: ExternalApiRecord) {
  const present = [
    record.name,
    record.description,
    record.openapiVersion,
    record.updatedAt,
    record.specificationUrl,
  ].filter(Boolean).length;
  return present / 5;
}

function rounded(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function rankExternalDiscoveryResults(
  records: readonly ExternalApiRecord[],
  query: string,
  now = Date.now(),
) {
  return records
    .map((record) => {
      const factors = {
        textRelevance: textRelevance(record, query),
        sourceFreshness: sourceFreshness(record, now),
        openApiMetadata: openApiMetadata(record),
      };
      return {
        record,
        textRelevance: factors.textRelevance,
        matchScore: Math.round(
          (factors.textRelevance * 0.75 +
            factors.sourceFreshness * 0.15 +
            factors.openApiMetadata * 0.1) *
            100,
        ),
        discovery: {
          source: PUBLIC_EXTERNAL_DISCOVERY_SOURCE,
          sourceLabel: PUBLIC_EXTERNAL_DISCOVERY_SOURCE_LABEL,
          scope: PUBLIC_EXTERNAL_DISCOVERY_SCOPE,
          verification: "UNVERIFIED_EXTERNAL" as const,
          matchScore: 0,
          rankingFactors: {
            textRelevance: rounded(factors.textRelevance),
            sourceFreshness: rounded(factors.sourceFreshness),
            openApiMetadata: rounded(factors.openApiMetadata),
          },
          evidence: {
            provider: record.provider,
            sourceRecordUrl: record.sourceRecordUrl,
            specificationUrl: record.specificationUrl,
            openapiVersion: record.openapiVersion,
            updatedAt: record.updatedAt,
          },
        },
      };
    })
    .filter((result) => result.textRelevance > 0)
    .map((result) => ({
      ...result,
      discovery: { ...result.discovery, matchScore: result.matchScore },
    }))
    .sort((left, right) => {
      const scoreDifference = right.discovery.matchScore - left.discovery.matchScore;
      if (scoreDifference !== 0) return scoreDifference;

      const textDifference =
        right.discovery.rankingFactors.textRelevance - left.discovery.rankingFactors.textRelevance;
      if (textDifference !== 0) return textDifference;

      const freshnessDifference =
        right.discovery.rankingFactors.sourceFreshness - left.discovery.rankingFactors.sourceFreshness;
      if (freshnessDifference !== 0) return freshnessDifference;

      const nameDifference = compareStrings(normalize(left.record.name), normalize(right.record.name));
      if (nameDifference !== 0) return nameDifference;
      return compareStrings(left.record.id, right.record.id);
    })
    .map(({ record, discovery }) => ({
      id: record.id,
      kind: "EXTERNAL_DISCOVERY" as const,
      name: record.name,
      description: record.description,
      url: record.specificationUrl,
      verification: {
        status: "UNVERIFIED_EXTERNAL" as const,
        reason: "SOURCE_METADATA_ONLY_NO_BOND402_CHECK" as const,
      },
      discovery,
      links: {
        sourceRecord: record.sourceRecordUrl,
        specification: record.specificationUrl,
      },
    }));
}

function parseRecord(providerKey: string, rawEntry: unknown): ExternalApiRecord | null {
  const entry = asRecord(rawEntry);
  const provider = safeString(providerKey, 160);
  const preferred = safeString(entry?.preferred, 80);
  const versions = asRecord(entry?.versions);
  const version = preferred && versions ? asRecord(versions[preferred]) : null;
  const info = asRecord(version?.info);
  if (!provider || !preferred || !version || !info) return null;

  const specificationUrl = safeHttpsUrl(version.swaggerUrl) ?? safeHttpsUrl(version.swaggerYamlUrl);
  if (!specificationUrl) return null;

  const sourceRecordUrl = safeHttpsUrl(version.link) ?? specificationUrl;
  const name =
    safeString(info.title, 200) ??
    safeString(info["x-serviceName"], 200) ??
    safeString(info["x-providerName"], 200) ??
    provider;
  const rawCategories = Array.isArray(info["x-apisguru-categories"]) ? info["x-apisguru-categories"] : [];
  const categories = rawCategories
    .map((category) => safeString(category, 80))
    .filter((category): category is string => Boolean(category))
    .slice(0, 8);

  return {
    id: `external:apis-guru:${encodeURIComponent(provider)}:${encodeURIComponent(preferred)}`,
    provider,
    version: preferred,
    name,
    description: safeString(info.description, 600),
    categories,
    openapiVersion: safeString(version.openapiVer, 32),
    updatedAt: validDate(version.updated),
    specificationUrl,
    sourceRecordUrl,
  };
}

export function parseApisGuruCatalog(payload: unknown) {
  const catalog = asRecord(payload);
  if (!catalog) return [];

  return Object.entries(catalog)
    .map(([provider, entry]) => parseRecord(provider, entry))
    .filter((record): record is ExternalApiRecord => Boolean(record))
    .sort((left, right) => compareStrings(left.id, right.id));
}

export async function loadApisGuruCatalog(
  fetcher: ExternalFetch = fetch,
  now = Date.now(),
): Promise<ExternalDiscoveryLoadResult> {
  if (cachedRecords && cachedRecords.expiresAt > now) {
    return { status: "AVAILABLE", records: cachedRecords.records };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`APIs.guru returned ${response.status}.`);

    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("APIs.guru response exceeded the safety limit.");
    }
    const records = parseApisGuruCatalog(JSON.parse(text));
    if (records.length === 0) throw new Error("APIs.guru returned no usable OpenAPI records.");

    cachedRecords = { expiresAt: now + CACHE_TTL_MS, records };
    return { status: "AVAILABLE", records };
  } catch {
    return { status: "UNAVAILABLE", records: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export function resetApisGuruCatalogCacheForTests() {
  cachedRecords = null;
}