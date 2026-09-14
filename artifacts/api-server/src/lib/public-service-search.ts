export const PUBLIC_DISCOVERY_SOURCE = "BOND402_INTERNAL_CATALOG" as const;
export const PUBLIC_DISCOVERY_SOURCE_LABEL = "Interne Bond402-Katalogdaten" as const;
export const INTERNAL_RELEVANCE_THRESHOLD = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PublicSearchService = {
  id: string;
  name: string;
  url: string;
  latestCheckAt: string | null;
  trustMetrics: {
    sampleCount: number;
  };
};

export type PublicStoredDiscoveryRecord = {
  id: string;
  canonicalUrl: string;
  source: string;
  sourceUrl: string;
  name: string;
  description: string | null;
  provider: string | null;
  version: string | null;
  sources?: readonly { label: string; url: string }[] | null;
  discoveredAt: Date | string;
  verificationStatus: string;
  trustStatus: string;
};

export type PublicDiscoveryMetadata = {
  source: typeof PUBLIC_DISCOVERY_SOURCE;
  sourceLabel: typeof PUBLIC_DISCOVERY_SOURCE_LABEL;
  scope: "LISTED_SERVICES_ONLY";
  matchScore: number;
  rankingFactors: {
    textRelevance: number;
    observationCoverage: number;
    observationFreshness: number;
    publicSource: number;
  };
  evidence: {
    liveObservationCount: number;
    latestObservationAt: string | null;
    publicSourceUrl: string;
  };
};

export type PublicStoredDiscoveryItem = {
  id: string;
  kind: "INTERNAL_DISCOVERY";
  name: string;
  description: string | null;
  url: string;
  verification: {
    status: string;
    reason: "PERSISTED_PUBLIC_METADATA_NO_BOND402_CHECK";
  };
  trust: {
    status: string;
  };
  discovery: {
    source: string;
    sourceLabel: string;
    scope: "PUBLIC_INTERNAL_DISCOVERY";
    verification: string;
    trustStatus: string;
    matchScore: number;
    rankingFactors: {
      textRelevance: number;
      discoveryFreshness: number;
      publicSource: number;
    };
    evidence: {
      canonicalUrl: string;
      sourceUrl: string;
      provider: string | null;
      version: string | null;
      discoveredAt: string;
    };
    sources: readonly { label: string; url: string }[];
  };
};

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

function textRelevance(service: PublicSearchService, query: string) {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) return 0;

  const normalizedName = normalize(service.name);
  const normalizedUrl = normalize(service.url);
  const queryTokens = tokens(normalizedQuery);
  const nameTokens = tokens(service.name);
  const matchingNameTokens = queryTokens.filter((token) =>
    nameTokens.some((nameToken) => nameToken === token || nameToken.startsWith(token)),
  );

  if (normalizedName === normalizedQuery) return 1;
  if (normalizedName.startsWith(normalizedQuery)) return 0.9;
  if (queryTokens.length > 0 && matchingNameTokens.length === queryTokens.length) return 0.8;
  if (normalizedUrl.includes(normalizedQuery)) return 0.65;
  if (matchingNameTokens.length > 0) {
    return 0.35 * (matchingNameTokens.length / queryTokens.length);
  }
  return 0;
}

function observationCoverage(service: PublicSearchService) {
  return Math.min(1, Math.max(0, service.trustMetrics.sampleCount) / 5);
}

function observationFreshness(service: PublicSearchService, now: number) {
  if (!service.latestCheckAt) return 0;
  const timestamp = Date.parse(service.latestCheckAt);
  if (!Number.isFinite(timestamp)) return 0;
  const age = Math.max(0, now - timestamp);
  if (age <= DAY_MS) return 1;
  if (age <= 7 * DAY_MS) return 0.75;
  if (age <= 30 * DAY_MS) return 0.5;
  return 0.25;
}

function rounded(value: number) {
  return Math.round(value * 1000) / 1000;
}

function storedDiscoveryTextRelevance(record: PublicStoredDiscoveryRecord, query: string) {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) return 0;
  const normalizedName = normalize(record.name);
  const queryTokens = tokens(normalizedQuery);
  const searchableText = normalize(
    [record.name, record.provider, record.description].filter(Boolean).join(" "),
  );
  const matchingTokens = queryTokens.filter((token) => searchableText.includes(token));

  if (normalizedName === normalizedQuery) return 1;
  if (normalizedName.startsWith(normalizedQuery)) return 0.92;
  if (queryTokens.length > 0 && queryTokens.every((token) => normalizedName.includes(token))) return 0.82;
  if (queryTokens.length > 0 && matchingTokens.length === queryTokens.length) return 0.68;
  if (matchingTokens.length > 0) return 0.35 * (matchingTokens.length / queryTokens.length);
  return 0;
}

function storedDiscoveryFreshness(record: PublicStoredDiscoveryRecord, now: number) {
  const timestamp = Date.parse(
    record.discoveredAt instanceof Date ? record.discoveredAt.toISOString() : record.discoveredAt,
  );
  if (!Number.isFinite(timestamp)) return 0;
  const age = Math.max(0, now - timestamp);
  if (age <= DAY_MS) return 1;
  if (age <= 7 * DAY_MS) return 0.75;
  if (age <= 30 * DAY_MS) return 0.5;
  if (age <= 365 * DAY_MS) return 0.25;
  return 0.1;
}

function storedDiscoverySourceLabel(source: string) {
  if (source === "APIS_GURU_OPENAPI_DIRECTORY") return "APIs.guru OpenAPI-Verzeichnis";
  if (source === "PUBLIC_APIS_DIRECTORY") return "Public APIs Community-Verzeichnis";
  return source;
}

export function rankPublicDiscoveryResults(
  records: readonly PublicStoredDiscoveryRecord[],
  query: string,
  now = Date.now(),
): PublicStoredDiscoveryItem[] {
  return records
    .map((record) => {
      const textRelevanceValue = storedDiscoveryTextRelevance(record, query);
      const discoveryFreshness = storedDiscoveryFreshness(record, now);
      const matchScore = Math.round(
        (textRelevanceValue * 0.75 + discoveryFreshness * 0.15 + 0.1) * 100,
      );
      return {
        record,
        textRelevanceValue,
        discoveryFreshness,
        matchScore,
      };
    })
    .filter((result) => result.textRelevanceValue > 0 || query.trim().length === 0)
    .sort((left, right) => {
      const scoreDifference = right.matchScore - left.matchScore;
      if (scoreDifference !== 0) return scoreDifference;
      const textDifference = right.textRelevanceValue - left.textRelevanceValue;
      if (textDifference !== 0) return textDifference;
      const freshnessDifference = right.discoveryFreshness - left.discoveryFreshness;
      if (freshnessDifference !== 0) return freshnessDifference;
      const nameDifference = compareStrings(normalize(left.record.name), normalize(right.record.name));
      if (nameDifference !== 0) return nameDifference;
      return compareStrings(left.record.id, right.record.id);
    })
    .map(({ record, textRelevanceValue, discoveryFreshness, matchScore }) => ({
      id: record.id,
      kind: "INTERNAL_DISCOVERY" as const,
      name: record.name,
      description: record.description,
      url: record.canonicalUrl,
      verification: {
        status: record.verificationStatus,
        reason: "PERSISTED_PUBLIC_METADATA_NO_BOND402_CHECK" as const,
      },
      trust: {
        status: record.trustStatus,
      },
      discovery: {
        source: record.source,
        sourceLabel: storedDiscoverySourceLabel(record.source),
        scope: "PUBLIC_INTERNAL_DISCOVERY" as const,
        verification: record.verificationStatus,
        trustStatus: record.trustStatus,
        matchScore,
        rankingFactors: {
          textRelevance: rounded(textRelevanceValue),
          discoveryFreshness: rounded(discoveryFreshness),
          publicSource: 1,
        },
        evidence: {
          canonicalUrl: record.canonicalUrl,
          sourceUrl: record.sourceUrl,
          provider: record.provider,
          version: record.version,
          discoveredAt:
            record.discoveredAt instanceof Date
              ? record.discoveredAt.toISOString()
              : record.discoveredAt,
        },
        sources: record.sources ?? [
          { label: storedDiscoverySourceLabel(record.source), url: record.sourceUrl },
        ],
      },
    }));
}

export function rankPublicServiceResults<T extends PublicSearchService>(
  services: readonly T[],
  query: string,
  now = Date.now(),
) {
  const ranked = services.map((service) => {
    const factors = {
      textRelevance: textRelevance(service, query),
      observationCoverage: observationCoverage(service),
      observationFreshness: observationFreshness(service, now),
      publicSource: service.url.trim() ? 1 : 0,
    };
    const matchScore = Math.round(
      (factors.textRelevance * 0.6 +
        factors.observationCoverage * 0.25 +
        factors.observationFreshness * 0.1 +
        factors.publicSource * 0.05) *
        100,
    );

    return {
      service,
      discovery: {
        source: PUBLIC_DISCOVERY_SOURCE,
        sourceLabel: PUBLIC_DISCOVERY_SOURCE_LABEL,
        scope: "LISTED_SERVICES_ONLY" as const,
        matchScore,
        rankingFactors: {
          textRelevance: rounded(factors.textRelevance),
          observationCoverage: rounded(factors.observationCoverage),
          observationFreshness: rounded(factors.observationFreshness),
          publicSource: rounded(factors.publicSource),
        },
        evidence: {
          liveObservationCount: service.trustMetrics.sampleCount,
          latestObservationAt: service.latestCheckAt,
          publicSourceUrl: service.url,
        },
      },
    };
  });

  return ranked
    .sort((left, right) => {
      const scoreDifference = right.discovery.matchScore - left.discovery.matchScore;
      if (scoreDifference !== 0) return scoreDifference;

      const textDifference =
        right.discovery.rankingFactors.textRelevance - left.discovery.rankingFactors.textRelevance;
      if (textDifference !== 0) return textDifference;

      const freshnessDifference =
        right.discovery.rankingFactors.observationFreshness -
        left.discovery.rankingFactors.observationFreshness;
      if (freshnessDifference !== 0) return freshnessDifference;

      const nameDifference = compareStrings(
        normalize(left.service.name),
        normalize(right.service.name),
      );
      if (nameDifference !== 0) return nameDifference;
      return compareStrings(left.service.id, right.service.id);
    })
    .map(({ service, discovery }) => ({ id: service.id, discovery }));
}

export function shouldUseExternalDiscoveryFallback(
  query: string,
  rankedResults: readonly {
    discovery: Pick<PublicDiscoveryMetadata, "matchScore" | "rankingFactors">;
  }[],
  persistedDiscoveryResults: readonly {
    discovery: { rankingFactors: { textRelevance: number } };
  }[] = [],
) {
  const hasRelevantObservedMatch = rankedResults.some(
    ({ discovery }) =>
      discovery.rankingFactors.textRelevance > 0 &&
      discovery.rankingFactors.observationCoverage > 0,
  );
  const hasRelevantPersistedMatch = persistedDiscoveryResults.some(
    ({ discovery }) => discovery.rankingFactors.textRelevance > 0,
  );

  return (
    query.trim().length > 0 &&
    !rankedResults.some(({ discovery }) => discovery.matchScore >= INTERNAL_RELEVANCE_THRESHOLD) &&
    !hasRelevantObservedMatch &&
    !hasRelevantPersistedMatch
  );
}