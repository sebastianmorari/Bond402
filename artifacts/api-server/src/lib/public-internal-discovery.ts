import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  publicDiscoveryRecordsTable,
  type PublicDiscoveryRecordRow,
} from "@workspace/db";
import type { ExternalApiRecord } from "./public-external-discovery";

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 600;
const MAX_PROVIDER_LENGTH = 160;
const MAX_VERSION_LENGTH = 80;
export const PUBLIC_DISCOVERY_RECORD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SOURCE_ATTRIBUTIONS = 4;

export const PUBLIC_INTERNAL_DISCOVERY_SOURCE = "BOND402_INTERNAL_DISCOVERY" as const;
export const PUBLIC_INTERNAL_DISCOVERY_SOURCE_LABEL = "Interne Bond402-Discovery" as const;
export const PUBLIC_INTERNAL_DISCOVERY_SCOPE = "PUBLIC_INTERNAL_DISCOVERY" as const;

export type PublicDiscoveryCandidate = {
  url: string;
  source: string;
  sourceUrl: string;
  name: string;
  description?: string | null;
  provider?: string | null;
  version?: string | null;
  verificationStatus?: string;
  trustStatus?: string;
  sources?: readonly { label: string; url: string }[];
};

type PublicDiscoveryDbWriter = Pick<typeof db, "insert">;
type PublicDiscoveryDbReader = Pick<typeof db, "select">;
type PublicDiscoveryDbDeleter = Pick<typeof db, "delete">;

function boundedText(value: string | null | undefined, maxLength: number) {
  if (typeof value !== "string") return null;
  const sanitized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return sanitized ? sanitized.slice(0, maxLength) : null;
}

function safeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some((key) => /(?:api[-_]?key|auth|credential|password|secret|signature|sig|token)/i.test(key))) {
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSources(
  candidate: Pick<PublicDiscoveryCandidate, "source" | "sourceUrl" | "sources">,
) {
  const sources = [
    ...(candidate.sources ?? []),
    { label: candidate.source, url: candidate.sourceUrl },
  ]
    .map((source) => {
      const label = boundedText(source.label, 200);
      const url = safeHttpsUrl(source.url);
      return label && url ? { label, url } : null;
    })
    .filter((source): source is { label: string; url: string } => Boolean(source));
  return [...new Map(sources.map((source) => [source.url, source])).values()]
    .sort((left, right) => left.label.localeCompare(right.label) || left.url.localeCompare(right.url))
    .slice(0, MAX_SOURCE_ATTRIBUTIONS);
}

export function canonicalPublicDiscoveryUrl(value: string) {
  const safeUrl = safeHttpsUrl(value);
  if (!safeUrl) return null;
  try {
    const url = new URL(safeUrl);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

export function publicDiscoveryId(canonicalUrl: string) {
  const digest = createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 32);
  return `public-discovery:${digest}`;
}

export function buildPublicDiscoveryCandidate(input: PublicDiscoveryCandidate) {
  const sourceUrl = safeHttpsUrl(input.sourceUrl);
  const canonicalUrl = canonicalPublicDiscoveryUrl(input.url);
  const name = boundedText(input.name, MAX_NAME_LENGTH);
  if (!sourceUrl || !canonicalUrl || !name) return null;

  return {
    id: publicDiscoveryId(canonicalUrl),
    canonicalUrl,
    source: boundedText(input.source, 120) ?? "UNKNOWN_PUBLIC_SOURCE",
    sourceUrl,
    name,
    description: boundedText(input.description, MAX_DESCRIPTION_LENGTH),
    provider: boundedText(input.provider, MAX_PROVIDER_LENGTH),
    version: boundedText(input.version, MAX_VERSION_LENGTH),
    verificationStatus: boundedText(input.verificationStatus, 80) ?? "UNVERIFIED_EXTERNAL",
    trustStatus: boundedText(input.trustStatus, 80) ?? "UNKNOWN",
    sources: normalizeSources(input),
  };
}

export function publicDiscoveryCandidateFromExternalRecord(record: ExternalApiRecord) {
  return {
    url: record.specificationUrl,
    source: record.source,
    sourceUrl: record.sourceUrl,
    name: record.name,
    description: record.description,
    provider: record.provider,
    version: record.version,
    verificationStatus: "UNVERIFIED_EXTERNAL",
    trustStatus: "UNKNOWN",
    ...(record.sources ? { sources: record.sources } : {}),
  } satisfies PublicDiscoveryCandidate;
}

export function dedupePublicDiscoveryCandidates(
  candidates: readonly PublicDiscoveryCandidate[],
) {
  const deduped = new Map<string, NonNullable<ReturnType<typeof buildPublicDiscoveryCandidate>>>();
  for (const candidate of candidates.map(buildPublicDiscoveryCandidate)) {
    if (!candidate) continue;
    const existing = deduped.get(candidate.canonicalUrl);
    if (!existing) {
      deduped.set(candidate.canonicalUrl, candidate);
      continue;
    }
    deduped.set(candidate.canonicalUrl, {
      ...existing,
      sources: normalizeSources({
        ...existing,
        sources: [...(existing.sources ?? []), ...(candidate.sources ?? [])],
      }),
    });
  }
  return [...deduped.values()];
}

export async function upsertPublicDiscoveryRecords(
  candidates: readonly PublicDiscoveryCandidate[],
  executor: PublicDiscoveryDbWriter = db,
) {
  const records = dedupePublicDiscoveryCandidates(candidates);
  if (records.length === 0) return [] as PublicDiscoveryRecordRow[];

  const now = new Date();
  return executor
    .insert(publicDiscoveryRecordsTable)
    .values(
      records.map((record) => ({
        ...record,
        discoveredAt: now,
        lastSeenAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: publicDiscoveryRecordsTable.canonicalUrl,
      set: {
        id: sql`excluded.id`,
        source: sql`excluded.source`,
        sourceUrl: sql`excluded.source_url`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        provider: sql`excluded.provider`,
        version: sql`excluded.version`,
        verificationStatus: sql`excluded.verification_status`,
        trustStatus: sql`excluded.trust_status`,
        sources: sql`excluded.sources`,
        lastSeenAt: now,
      },
    })
    .returning();
}

export async function loadPublicDiscoveryRecords(
  executor: PublicDiscoveryDbReader = db,
  now = Date.now(),
) {
  return executor
    .select()
    .from(publicDiscoveryRecordsTable)
    .where(
      gte(
        publicDiscoveryRecordsTable.lastSeenAt,
        new Date(now - PUBLIC_DISCOVERY_RECORD_MAX_AGE_MS),
      ),
    )
    .orderBy(desc(publicDiscoveryRecordsTable.lastSeenAt))
    .limit(500);
}

export async function refreshPublicDiscoveryRecords(
  candidates: readonly PublicDiscoveryCandidate[],
  sourceUrls: readonly string[],
  executor: PublicDiscoveryDbWriter & PublicDiscoveryDbDeleter = db,
  now = Date.now(),
) {
  const records = dedupePublicDiscoveryCandidates(candidates);
  if (records.length > 0) {
    await executor
      .insert(publicDiscoveryRecordsTable)
      .values(
        records.map((record) => ({
          ...record,
          discoveredAt: new Date(now),
          lastSeenAt: new Date(now),
        })),
      )
      .onConflictDoUpdate({
        target: publicDiscoveryRecordsTable.canonicalUrl,
        set: {
          id: sql`excluded.id`,
          source: sql`excluded.source`,
          sourceUrl: sql`excluded.source_url`,
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          provider: sql`excluded.provider`,
          version: sql`excluded.version`,
          verificationStatus: sql`excluded.verification_status`,
          trustStatus: sql`excluded.trust_status`,
          sources: sql`excluded.sources`,
          lastSeenAt: new Date(now),
        },
      })
      .returning();
  }

  const normalizedSourceUrls = sourceUrls
    .map((url) => safeHttpsUrl(url))
    .filter((url): url is string => Boolean(url));
  if (normalizedSourceUrls.length > 0) {
    await executor
      .delete(publicDiscoveryRecordsTable)
      .where(
        and(
          inArray(publicDiscoveryRecordsTable.sourceUrl, normalizedSourceUrls),
          lt(
            publicDiscoveryRecordsTable.lastSeenAt,
            new Date(now - PUBLIC_DISCOVERY_RECORD_MAX_AGE_MS),
          ),
        ),
      );
  }
  return records;
}

export async function loadPublicDiscoveryRecord(
  id: string,
  executor: PublicDiscoveryDbReader = db,
) {
  const [record] = await executor
    .select()
    .from(publicDiscoveryRecordsTable)
    .where(eq(publicDiscoveryRecordsTable.id, id))
    .limit(1);
  return record;
}