import { CORE_SCHEMA, load as loadYaml } from "js-yaml";
import {
  externalRecordId,
  loadApisGuruCatalog,
  type ExternalApiRecord,
  parseExternalRecordId,
} from "./public-external-discovery";
import { safeGet, validatePublicUrl } from "./api-verifier";

const MAX_ENDPOINTS = 60;
const MAX_SERVERS = 8;
const MAX_AUTH_SCHEMES = 16;
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

type UnknownRecord = Record<string, unknown>;
type AuthStatus = "REQUIRED" | "NOT_REQUIRED" | "NOT_DECLARED" | "UNKNOWN";

export type ExternalApiDetail = {
  id: string;
  kind: "EXTERNAL_DISCOVERY_DETAIL";
  name: string;
  provider: string;
  version: string;
  description: string | null;
  source: {
    id: typeof import("./public-external-discovery").PUBLIC_EXTERNAL_DISCOVERY_SOURCE;
    label: typeof import("./public-external-discovery").PUBLIC_EXTERNAL_DISCOVERY_SOURCE_LABEL;
    catalogUrl: typeof import("./public-external-discovery").PUBLIC_EXTERNAL_DISCOVERY_SOURCE_URL;
    recordUrl: string;
    specificationUrl: string;
  };
  verification: {
    status: "UNVERIFIED_EXTERNAL";
    reason: "SPECIFICATION_METADATA_ONLY_NO_BOND402_CHECK";
  };
  specification: {
    status: "PARSED" | "UNAVAILABLE" | "UNSUPPORTED";
    openapiVersion: string | null;
    title: string | null;
    description: string | null;
    servers: Array<{ url: string; description: string | null; templated: boolean }>;
    auth: {
      status: AuthStatus;
      schemes: Array<{ name: string; type: string; scheme: string | null; location: string | null }>;
    };
    endpoints: Array<{
      method: string;
      path: string;
      summary: string | null;
      operationId: string | null;
      auth: AuthStatus;
      safeToProbe: boolean;
      reason: string;
    }>;
  };
  safeEndpoint: {
    method: "GET" | "HEAD";
    path: string;
    url: string;
    reason: "EXPLICITLY_PUBLIC_PARAMETER_FREE_READ";
  } | null;
  safeEndpoints: Array<{
    method: "GET" | "HEAD";
    path: string;
    url: string;
    reason: "EXPLICITLY_PUBLIC_PARAMETER_FREE_READ";
  }>;
  safeEndpointNote: string;
};

type ParsedSpec = {
  status: "PARSED" | "UNAVAILABLE" | "UNSUPPORTED";
  document: UnknownRecord | null;
  bodyDescription: string | null;
};

type EndpointCandidate = {
  method: "GET" | "HEAD";
  path: string;
  url: string;
};

const detailCache = new Map<string, { expiresAt: number; detail: ExternalApiDetail }>();

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function safeString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const sanitized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return sanitized ? sanitized.slice(0, maxLength) : null;
}

function safeUrl(value: unknown) {
  const candidate = safeString(value, 2_000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isRecordMap(value: unknown): value is UnknownRecord {
  return asRecord(value) !== null;
}

function parseSpecification(body: string, contentType: string | undefined): ParsedSpec {
  const trimmed = body.trim();
  if (!trimmed) return { status: "UNAVAILABLE", document: null, bodyDescription: null };

  let parsed: unknown;
  try {
    parsed = contentType?.includes("json") || trimmed.startsWith("{")
      ? JSON.parse(trimmed)
      : loadYaml(trimmed, { schema: CORE_SCHEMA });
  } catch {
    return { status: "UNSUPPORTED", document: null, bodyDescription: "Die Spezifikation konnte nicht sicher geparst werden." };
  }

  const document = asRecord(parsed);
  if (!document || (typeof document.openapi !== "string" && typeof document.swagger !== "string")) {
    return { status: "UNSUPPORTED", document: null, bodyDescription: "Die Quelle enthält kein unterstütztes OpenAPI- oder Swagger-Dokument." };
  }
  return {
    status: "PARSED",
    document,
    bodyDescription: safeString(asRecord(document.info)?.description, 1_000),
  };
}

function getSpecVersion(document: UnknownRecord) {
  return safeString(document.openapi, 32) ?? safeString(document.swagger, 32);
}

function getInfo(document: UnknownRecord) {
  const info = asRecord(document.info);
  return {
    title: safeString(info?.title, 200),
    description: safeString(info?.description, 1_000),
  };
}

function getServers(document: UnknownRecord): Array<{ url: string; description: string | null; templated: boolean }> {
  const servers = Array.isArray(document.servers)
    ? document.servers
        .map((server) => {
          const entry = asRecord(server);
          const url = safeUrl(entry?.url);
          return url
            ? {
                url,
                description: safeString(entry?.description, 300),
                templated: url.includes("{"),
              }
            : null;
        })
        .filter((server): server is { url: string; description: string | null; templated: boolean } => Boolean(server))
        .slice(0, MAX_SERVERS)
    : [];

  if (servers.length > 0) return servers;

  const host = safeString(document.host, 255);
  if (!host || host.includes("{")) return [];
  const basePath = safeString(document.basePath, 500) ?? "/";
  const schemes = Array.isArray(document.schemes) ? document.schemes : ["https"];
  return schemes
    .filter((scheme): scheme is string => scheme === "https" || scheme === "http")
    .map((scheme) => safeUrl(`${scheme}://${host}${basePath}`))
    .filter((url): url is string => Boolean(url))
    .slice(0, MAX_SERVERS)
    .map((url) => ({ url, description: null, templated: false }));
}

function getSecuritySchemes(document: UnknownRecord) {
  const components = asRecord(document.components);
  const raw = asRecord(components?.securitySchemes) ?? asRecord(document.securityDefinitions) ?? {};
  return Object.entries(raw)
    .map(([name, value]) => {
      const scheme = asRecord(value);
      if (!scheme) return null;
      return {
        name: safeString(name, 120) ?? "unknown",
        type: safeString(scheme.type, 40) ?? "unknown",
        scheme: safeString(scheme.scheme, 80),
        location: safeString(scheme.in, 40),
      };
    })
    .filter((scheme): scheme is { name: string; type: string; scheme: string | null; location: string | null } => Boolean(scheme))
    .slice(0, MAX_AUTH_SCHEMES);
}

function securityStatus(operation: UnknownRecord, document: UnknownRecord): AuthStatus {
  const security = Object.prototype.hasOwnProperty.call(operation, "security")
    ? operation.security
    : document.security;
  if (!Array.isArray(security)) return "NOT_DECLARED";
  return security.length === 0 ? "NOT_REQUIRED" : "REQUIRED";
}

function requiredParameters(pathItem: UnknownRecord, operation: UnknownRecord) {
  const parameters = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ];
  return parameters.some((parameter) => asRecord(parameter)?.required === true);
}

function joinEndpointUrl(serverUrl: string, path: string) {
  try {
    return new URL(`${serverUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`).toString();
  } catch {
    return null;
  }
}

function getEndpoints(document: UnknownRecord, servers: Array<{ url: string; templated: boolean }>) {
  const paths = asRecord(document.paths);
  if (!paths) return { endpoints: [], candidates: [] as EndpointCandidate[] };
  const endpoints: ExternalApiDetail["specification"]["endpoints"] = [];
  const candidates: EndpointCandidate[] = [];
  const documentHasExplicitPublicSecurity = Array.isArray(document.security) && document.security.length === 0;

  for (const [path, rawPathItem] of Object.entries(paths).sort(([left], [right]) => left.localeCompare(right))) {
    if (!path.startsWith("/")) continue;
    const pathItem = asRecord(rawPathItem);
    if (!pathItem) continue;
    for (const method of ["get", "head", "post", "put", "patch", "delete", "options", "trace"]) {
      const operation = asRecord(pathItem[method]);
      if (!operation) continue;
      const auth = securityStatus(operation, document);
      const hasNoRequiredParameters = !requiredParameters(pathItem, operation);
      const hasNoPathTemplates = !path.includes("{");
      const explicitlyPublic = auth === "NOT_REQUIRED" || (documentHasExplicitPublicSecurity && !Object.prototype.hasOwnProperty.call(operation, "security"));
      const safeToProbe =
        (method === "get" || method === "head") &&
        explicitlyPublic &&
        hasNoRequiredParameters &&
        hasNoPathTemplates;
      const reason = safeToProbe
        ? "GET/HEAD ohne erforderliche Parameter und mit explizit leerer Security-Anforderung."
        : auth === "REQUIRED"
          ? "Die Spezifikation nennt eine Authentifizierungsanforderung."
          : !hasNoPathTemplates
            ? "Pfadvariablen wurden nicht mit geratenen Werten befüllt."
          : !hasNoRequiredParameters
            ? "Erforderliche Parameter wurden nicht erraten."
            : method !== "get" && method !== "head"
              ? "Nur nicht mutierende GET/HEAD-Endpunkte werden als Kandidat markiert."
              : "Die Spezifikation weist den Endpunkt nicht ausdrücklich als öffentlich aus.";
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: safeString(operation.summary ?? operation.description, 300),
        operationId: safeString(operation.operationId, 160),
        auth,
        safeToProbe,
        reason,
      });
      if (safeToProbe) {
        const server = servers.find((entry) => entry.templated === false && entry.url.startsWith("https://"));
        const url = server ? joinEndpointUrl(server.url, path) : null;
        if (url && candidates.length < 8) {
          candidates.push({ method: method.toUpperCase() as "GET" | "HEAD", path, url });
        }
      }
      if (endpoints.length >= MAX_ENDPOINTS) break;
    }
    if (endpoints.length >= MAX_ENDPOINTS) break;
  }
  return { endpoints, candidates };
}

function baseDetail(record: ExternalApiRecord): ExternalApiDetail {
  return {
    id: record.id,
    kind: "EXTERNAL_DISCOVERY_DETAIL",
    name: record.name,
    provider: record.provider,
    version: record.version,
    description: record.description,
    source: {
      id: "APIS_GURU_OPENAPI_DIRECTORY",
      label: "APIs.guru OpenAPI-Verzeichnis",
      catalogUrl: "https://api.apis.guru/v2/list.json",
      recordUrl: record.sourceRecordUrl,
      specificationUrl: record.specificationUrl,
    },
    verification: {
      status: "UNVERIFIED_EXTERNAL",
      reason: "SPECIFICATION_METADATA_ONLY_NO_BOND402_CHECK",
    },
    specification: {
      status: "UNAVAILABLE",
      openapiVersion: record.openapiVersion,
      title: record.name,
      description: record.description,
      servers: [],
      auth: { status: "UNKNOWN", schemes: [] },
      endpoints: [],
    },
    safeEndpoint: null,
    safeEndpoints: [],
    safeEndpointNote: "Ohne sicher öffentliche, parameterfreie GET/HEAD-Angabe wird kein Prüfziel vorgeschlagen.",
  };
}

export function parseExternalSpecification(record: ExternalApiRecord, body: string, contentType?: string) {
  const detail = baseDetail(record);
  const parsed = parseSpecification(body, contentType);
  detail.specification.status = parsed.status;
  if (parsed.status !== "PARSED" || !parsed.document) {
    detail.safeEndpointNote = parsed.bodyDescription ?? detail.safeEndpointNote;
    return { detail, candidates: [] as EndpointCandidate[] };
  }

  const document = parsed.document;
  const info = getInfo(document);
  const servers = getServers(document);
  const { endpoints, candidates } = getEndpoints(document, servers);
  const schemes = getSecuritySchemes(document);
  const documentSecurity = document.security;
  const auth: AuthStatus = Array.isArray(documentSecurity)
    ? documentSecurity.length === 0
      ? "NOT_REQUIRED"
      : "REQUIRED"
    : schemes.length > 0
      ? "REQUIRED"
      : "NOT_DECLARED";

  detail.name = info.title ?? detail.name;
  detail.description = info.description ?? detail.description;
  detail.specification = {
    status: "PARSED",
    openapiVersion: getSpecVersion(document) ?? record.openapiVersion,
    title: info.title,
    description: info.description,
    servers,
    auth: { status: auth, schemes },
    endpoints,
  };
  detail.safeEndpointNote = candidates.length > 0
    ? "Dieser Kandidat ist nur aufgrund expliziter Spezifikationsangaben ausgewählt; Bond402 hat ihn noch nicht geprüft."
    : detail.safeEndpointNote;
  return { detail, candidates };
}

async function loadExternalDetail(record: ExternalApiRecord): Promise<ExternalApiDetail> {
  const cached = detailCache.get(record.id);
  if (cached && cached.expiresAt > Date.now()) return cached.detail;

  const initial = baseDetail(record);
  try {
    const response = await safeGet(record.specificationUrl, 4_000);
    const parsed = parseExternalSpecification(record, response.body, response.headers["content-type"]);
    const validatedCandidates: ExternalApiDetail["safeEndpoints"] = [];
    for (const candidate of parsed.candidates) {
      try {
        await validatePublicUrl(candidate.url, Date.now() + 2_000);
        validatedCandidates.push({
          ...candidate,
          reason: "EXPLICITLY_PUBLIC_PARAMETER_FREE_READ",
        });
      } catch {
        // Unsafe, private, or unstable targets stay unavailable for public actions.
      }
    }
    parsed.detail.safeEndpoints = validatedCandidates;
    parsed.detail.safeEndpoint = validatedCandidates[0] ?? null;
    if (parsed.candidates.length > 0 && validatedCandidates.length === 0) {
      parsed.detail.safeEndpointNote =
        "Die Spezifikation nennt Kandidaten, aber Bond402 konnte kein Netzwerkziel sicher als öffentlich bestätigen.";
    }
    detailCache.set(record.id, { expiresAt: Date.now() + DETAIL_CACHE_TTL_MS, detail: parsed.detail });
    return parsed.detail;
  } catch {
    detailCache.set(record.id, { expiresAt: Date.now() + DETAIL_CACHE_TTL_MS, detail: initial });
    return initial;
  }
}

export async function getExternalApiDetail(id: string) {
  const parsedId = parseExternalRecordId(id);
  if (!parsedId) return null;
  const catalog = await loadApisGuruCatalog();
  const record = catalog.records.find(
    (candidate) =>
      candidate.id === id ||
      (candidate.provider === parsedId.provider && candidate.version === parsedId.version) ||
      candidate.id === externalRecordId(parsedId.provider, parsedId.version),
  );
  return record ? loadExternalDetail(record) : null;
}

export function resetExternalDetailCacheForTests() {
  detailCache.clear();
}