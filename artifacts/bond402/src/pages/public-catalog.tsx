import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Bot, CheckCircle2, Search, Shield, ShieldAlert, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublicFooter } from "@/components/public-footer";
import { useAuth } from "@/lib/auth";
import { availabilityImpactLabel, checkClassificationLabel } from "@/lib/presentation";

const apiBase = `${window.location.origin}/api`;

type PublicService = {
  id: string;
  name: string;
  url: string;
  discovery?: {
    source: "BOND402_INTERNAL_CATALOG";
    sourceLabel: string;
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
  trustScore: number | null;
  trustExplanation: string;
  trustMetrics: {
    regionalAggregation: {
      state:
        | "SINGLE_REGION"
        | "MULTIPLE_REGIONS"
        | "CONTRADICTORY_REGIONAL_RESULTS"
        | "INSUFFICIENT_REGIONAL_DATA";
      regionCount: number;
      regions: string[];
      liveCheckCount: number;
      evaluatedCheckCount: number;
      unassignedLiveCheckCount: number;
      contradictorySignals: string[];
      observationBasis: "STORED_LIVE_CHECKS";
      continuousMonitoring: false;
      description: string;
    };
    sampleCount: number;
    timedSampleCount: number;
    uptimePercent: number | null;
    averageResponseTimeMs: number | null;
    p95ResponseTimeMs: number | null;
    p99ResponseTimeMs: number | null;
    withinTargetPercent: number | null;
    windowStartAt: string | null;
    latestCheckAt: string | null;
    weighting: { description: string };
  };
  signals: { https: string; tls: string; securityHeaders: string };
  domainVerification: { status: string; verifiedAt: string | null };
  latestStatus: "PASS" | "FAIL" | "REVIEW" | null;
  latestCheckAt: string | null;
  latestCheck: {
    checkedAt: string;
    status: "PASS" | "FAIL" | "REVIEW";
    reachable: boolean;
    responseTimeMs: number;
    structureMatch: boolean;
    httpStatus: number | null;
    https: boolean;
    tlsStatus: string;
    tlsExpiresAt: string | null;
    tlsDaysRemaining: number | null;
    securityHeaders: { status: string; present: string[]; missing: string[] };
    classification: string;
    availabilityImpact: string;
    probeRegion: string;
  } | null;
  access: { preActionRequiresDeveloperKey: boolean; liveCheckRequiresDeveloperKey: boolean };
};

type ExternalDiscoveryItem = {
  id: string;
  kind: "EXTERNAL_DISCOVERY";
  name: string;
  description: string | null;
  url: string;
  verification: {
    status: "UNVERIFIED_EXTERNAL";
    reason: "SOURCE_METADATA_ONLY_NO_BOND402_CHECK";
  };
  discovery: {
    source: "APIS_GURU_OPENAPI_DIRECTORY" | "PUBLIC_APIS_DIRECTORY";
    sourceLabel: string;
    scope: "PUBLIC_UNVERIFIED_OPENAPI" | "PUBLIC_UNVERIFIED_API_DIRECTORY";
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
  links: { sourceRecord: string; specification: string };
};

type InternalDiscoveryItem = {
  id: string;
  kind: "INTERNAL_DISCOVERY";
  name: string;
  description: string | null;
  url: string;
  verification: {
    status: string;
    reason: "PERSISTED_PUBLIC_METADATA_NO_BOND402_CHECK";
  };
  trust: { status: string };
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
  };
};

type ExternalDiscoveryDetail = {
  id: string;
  kind: "EXTERNAL_DISCOVERY_DETAIL";
  name: string;
  provider: string;
  version: string | null;
  description: string | null;
  source: {
    id: "APIS_GURU_OPENAPI_DIRECTORY" | "PUBLIC_APIS_DIRECTORY";
    label: string;
    catalogUrl: string;
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
      status: "REQUIRED" | "NOT_REQUIRED" | "NOT_DECLARED" | "UNKNOWN";
      schemes: Array<{ name: string; type: string; scheme: string | null; location: string | null }>;
    };
    endpoints: Array<{
      method: string;
      path: string;
      summary: string | null;
      operationId: string | null;
      auth: "REQUIRED" | "NOT_REQUIRED" | "NOT_DECLARED" | "UNKNOWN";
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

type CatalogSource = {
  source: "BOND402_INTERNAL_CATALOG" | "PUBLIC_EXTERNAL_CATALOG";
  sourceLabel: string;
  scope:
    | "LISTED_SERVICES_ONLY"
    | "LISTED_SERVICES_AND_PUBLIC_DISCOVERY"
    | "PUBLIC_UNVERIFIED_EXTERNAL_CATALOG";
  externalSources: boolean;
  mode: "INTERNAL_PRIMARY" | "EXTERNAL_FALLBACK";
  fallback: "NOT_USED" | "USED" | "UNAVAILABLE";
  sourceUrl?: string;
};

type CatalogResponse = {
  items: (PublicService | InternalDiscoveryItem | ExternalDiscoveryItem)[];
  query: string;
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
  source: CatalogSource;
};

type DecisionResponse = {
  decision: "ALLOW" | "CAUTION" | "BLOCK";
  reasons: string[];
  actionContext: string;
  freshness: { state: string; ageSeconds: number | null; maxAgeSeconds: number };
  policy: { id: string; version: string };
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  const body = await response.text();
  let parsed: unknown = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new Error(
      parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : `Die öffentlichen Daten konnten nicht geladen werden (HTTP ${response.status}).`,
    );
  }
  if (parsed === null) throw new Error("Die öffentlichen Daten waren keine gültige JSON-Antwort.");
  return parsed as T;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  let parsed: unknown = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new Error(
      parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
        ? parsed.error
        : `Die öffentlichen Daten konnten nicht geladen werden (HTTP ${response.status}).`,
    );
  }
  if (parsed === null) throw new Error("Die öffentlichen Daten waren keine gültige JSON-Antwort.");
  return parsed as T;
}

function decisionVariant(decision: string) {
  return decision === "ALLOW" ? "default" : decision === "BLOCK" ? "destructive" : "secondary";
}

function signalLabel(value: string) {
  return value === "CHECKED"
    ? "Geprüft"
    : value === "WARNING"
      ? "Auffällig"
      : value === "UNAVAILABLE"
        ? "Nicht verfügbar"
        : "Nicht bewertet";
}

function regionalStateLabel(value: PublicService["trustMetrics"]["regionalAggregation"]["state"]) {
  return value === "SINGLE_REGION"
    ? "Eine beobachtete Region"
    : value === "MULTIPLE_REGIONS"
      ? "Mehrere beobachtete Regionen"
      : value === "CONTRADICTORY_REGIONAL_RESULTS"
        ? "Widersprüchliche Regionen"
        : "Unzureichende Regionaldaten";
}

function isExternalDiscovery(item: PublicService | InternalDiscoveryItem | ExternalDiscoveryItem): item is ExternalDiscoveryItem {
  return "kind" in item && item.kind === "EXTERNAL_DISCOVERY";
}

function isInternalDiscovery(item: PublicService | InternalDiscoveryItem | ExternalDiscoveryItem): item is InternalDiscoveryItem {
  return "kind" in item && item.kind === "INTERNAL_DISCOVERY";
}

function isExternalDiscoveryDetail(item: PublicService | InternalDiscoveryItem | ExternalDiscoveryDetail): item is ExternalDiscoveryDetail {
  return "kind" in item && item.kind === "EXTERNAL_DISCOVERY_DETAIL";
}

function isInternalDiscoveryDetail(item: PublicService | InternalDiscoveryItem | ExternalDiscoveryDetail): item is InternalDiscoveryItem {
  return "kind" in item && item.kind === "INTERNAL_DISCOVERY";
}

function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Shield className="h-5 w-5" /></span>
            <span><span className="block font-bold leading-tight">Bond402</span><span className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Public Trust Catalog</span></span>
          </Link>
          <Link href="/api-docs" className="text-sm font-medium text-muted-foreground hover:text-foreground">API-Doku</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">{children}</main>
      <PublicFooter />
    </div>
  );
}

function ServiceCard({ service }: { service: PublicService }) {
  return (
    <Link href={`/catalog/${encodeURIComponent(service.id)}`} className="group block rounded-2xl border border-border/60 bg-card/60 p-5 transition hover:border-primary/50 hover:bg-card hover:shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span>
          <div className="min-w-0"><h2 className="truncate font-semibold">{service.name}</h2><p className="truncate font-mono text-xs text-muted-foreground">{service.url}</p></div>
        </div>
         <div className="flex flex-wrap justify-end gap-2">
           <Badge variant="outline">{service.discovery?.sourceLabel || "Interne Bond402-Daten"}</Badge>
           <Badge variant={service.latestStatus === "PASS" ? "default" : service.latestStatus === "FAIL" ? "destructive" : "outline"}>{service.latestStatus || "Neu"}</Badge>
           {service.latestCheck && (
             <Badge variant="outline">
               {checkClassificationLabel(service.latestCheck.classification)}
             </Badge>
           )}
         </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Trust Score</p><p className="mt-1 text-xl font-bold">{service.trustScore === null ? "—" : `${service.trustScore}%`}</p></div>
        <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Beobachtete Uptime</p><p className="mt-1 font-medium">{service.trustMetrics.uptimePercent === null ? "Noch keine" : `${service.trustMetrics.uptimePercent}%`}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">HTTPS: {signalLabel(service.signals.https)}</Badge>
        <Badge variant="outline">TLS: {signalLabel(service.signals.tls)}</Badge>
        {service.latestCheck && (
          <Badge variant="outline">{availabilityImpactLabel(service.latestCheck.availabilityImpact)}</Badge>
        )}
        <Badge variant="outline">Domain: {signalLabel(service.domainVerification.status === "VERIFIED" ? "CHECKED" : service.domainVerification.status === "NOT_EVALUATED" ? "NOT_EVALUATED" : "WARNING")}</Badge>
        <Badge variant="outline">Regionen: {regionalStateLabel(service.trustMetrics.regionalAggregation.state)}</Badge>
      </div>
      <p className="mt-4 line-clamp-2 text-sm leading-6 text-muted-foreground">{service.trustExplanation}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">Trust-Daten öffnen <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
    </Link>
  );
}

function ExternalServiceCard({ service }: { service: ExternalDiscoveryItem }) {
  return (
    <Link
      href={`/catalog/${encodeURIComponent(service.id)}`}
      className="group block rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 transition hover:border-amber-500/60 hover:bg-amber-500/10 hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{service.name}</h2>
            <p className="truncate font-mono text-xs text-muted-foreground">{service.discovery.evidence.provider}</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant="outline">{service.discovery.sourceLabel}</Badge>
          <Badge variant="secondary">Unverifiziert</Badge>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Suchtreffer</p>
          <p className="mt-1 text-xl font-bold">{service.discovery.matchScore}/100</p>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Version</p>
          <p className="mt-1 font-medium">{service.discovery.evidence.openapiVersion || "Nicht angegeben"}</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        {service.description || "Die Quelle liefert keine Beschreibung."}
      </p>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
         Nur Quelldaten aus {service.discovery.sourceLabel}. Bond402 hat diesen Eintrag nicht geprüft und vergibt keinen
         Trust-Status.
      </p>
       <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
         Bond402-Details öffnen <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </span>
    </Link>
  );
}

function InternalDiscoveryCard({ service }: { service: InternalDiscoveryItem }) {
  return (
    <Link
      href={`/catalog/${encodeURIComponent(service.id)}`}
      className="group block rounded-2xl border border-primary/20 bg-primary/5 p-5 transition hover:border-primary/50 hover:bg-primary/10 hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{service.name}</h2>
            <p className="truncate font-mono text-xs text-muted-foreground">{service.url}</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant="outline">{service.discovery.sourceLabel}</Badge>
          <Badge variant="secondary">Intern gespeichert</Badge>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Suchtreffer</p>
          <p className="mt-1 text-xl font-bold">{service.discovery.matchScore}/100</p>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Trust</p>
          <p className="mt-1 font-medium">{service.trust.status}</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        {service.description || "Die öffentliche Quelle liefert keine Beschreibung."}
      </p>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Persistierte öffentliche Metadaten aus {service.discovery.sourceLabel}. Bond402 hat diesen Eintrag nicht
        live geprüft und vergibt keinen Trust Score.
      </p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
        Discovery-Details öffnen <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
      </span>
    </Link>
  );
}

export function PublicCatalogPage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getJson<CatalogResponse>(`/public/services?q=${encodeURIComponent(submittedQuery)}&page=${page}&pageSize=12`)
      .then((result) => { if (active) { setData(result); setError(""); } })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [submittedQuery, page, retryCount]);

  return (
    <PublicLayout>
      <section className="max-w-3xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"><Bot className="h-4 w-4" /> Operator-freigegebenes Verzeichnis</div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Öffentliche Trust- und Discovery-Daten für AI Agents</h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">Dieses Verzeichnis enthält operator-gelistete Dienste und gespeicherte öffentliche Discovery-Metadaten. Es ist keine universelle Suchmaschine. ALLOW ist eine Risikoeinschätzung, keine Sicherheitsgarantie.</p>
      </section>
      <form className="mt-8 flex max-w-2xl gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dienstname oder API-URL suchen" aria-label="Katalog durchsuchen" />
        <Button type="submit"><Search className="mr-2 h-4 w-4" />Suchen</Button>
      </form>
      {error && <div role="alert" className="mt-8 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"><span>{error}</span><Button type="button" variant="outline" onClick={() => setRetryCount((value) => value + 1)}>Erneut versuchen</Button></div>}
       <div className="mt-10 flex items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">{data?.source.mode === "EXTERNAL_FALLBACK" ? "Öffentliche API-/OpenAPI-Fundstellen" : "Interne Katalog- und Discovery-Treffer"}</h2><p className="mt-1 text-sm text-muted-foreground">{data?.source.mode === "EXTERNAL_FALLBACK" ? "Externe, unverifizierte Quelldaten als Fallback" : data ? `${data.total} öffentliche Einträge` : "Öffentliche Einträge werden geladen"}</p></div><a href={`${apiBase}/openapi.json`} className="hidden text-sm font-medium text-primary hover:underline sm:block">OpenAPI JSON</a></div>
        {loading ? <div className="mt-6 grid gap-4 md:grid-cols-2"><div className="h-48 animate-pulse rounded-2xl bg-muted/50" /><div className="h-48 animate-pulse rounded-2xl bg-muted/50" /></div> : error ? null : data?.items.length ? <div className="mt-6 grid gap-4 md:grid-cols-2">{data.items.map((service) => isExternalDiscovery(service) ? <ExternalServiceCard key={service.id} service={service} /> : isInternalDiscovery(service) ? <InternalDiscoveryCard key={service.id} service={service} /> : <ServiceCard key={service.id} service={service} />)}</div> : <div className="mt-6 rounded-2xl border border-dashed border-border/70 p-12 text-center text-muted-foreground">Noch keine Dienste entsprechen dieser Suche.</div>}
      <div className="mt-8 flex items-center justify-between"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ArrowLeft className="mr-2 h-4 w-4" />Zurück</Button><span className="text-sm text-muted-foreground">Seite {page}</span><Button variant="outline" disabled={!data?.hasNextPage} onClick={() => setPage((value) => value + 1)}>Weiter<ArrowRight className="ml-2 h-4 w-4" /></Button></div>
    </PublicLayout>
  );
}

export function PublicServicePage() {
  const [, params] = useRoute<{ id: string }>("/catalog/:id");
  const rawId = params?.id || "";
  const id = (() => {
    try {
      return decodeURIComponent(rawId);
    } catch {
      return rawId;
    }
  })();
  const [service, setService] = useState<PublicService | InternalDiscoveryItem | ExternalDiscoveryDetail | null>(null);
  const [decision, setDecision] = useState<DecisionResponse | null>(null);
  const [context, setContext] = useState("GENERAL");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    getJson<PublicService | ExternalDiscoveryDetail>(`/public/services/${encodeURIComponent(id)}`)
      .then(async (serviceResult) => {
        setService(serviceResult);
        if (isExternalDiscoveryDetail(serviceResult) || isInternalDiscoveryDetail(serviceResult)) setDecision(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  useEffect(() => {
    if (!id || !service || isExternalDiscoveryDetail(service)) return;
    postJson<DecisionResponse>(`/public/services/${encodeURIComponent(id)}/pre-action-check`, { actionContext: context })
      .then(setDecision)
      .catch(() => undefined);
  }, [context, id, service]);

  if (service && isExternalDiscoveryDetail(service)) {
    return (
      <PublicLayout>
        <Link href="/catalog" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Zum Katalog
        </Link>
        <ExternalDiscoveryDetailView service={service} />
      </PublicLayout>
    );
  }

  if (service && isInternalDiscoveryDetail(service)) {
    return (
      <PublicLayout>
        <Link href="/catalog" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Zum Katalog
        </Link>
        <div className="mt-8 max-w-4xl">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <Badge variant="outline">Intern gespeicherte Discovery</Badge>
              <h1 className="mt-3 text-3xl font-bold tracking-tight">{service.name}</h1>
              <a href={service.url} target="_blank" rel="noreferrer" className="mt-2 block break-all font-mono text-sm text-primary hover:underline">{service.url}</a>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card/60 p-5 text-center">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Trust-Status</p>
              <p className="mt-2 font-semibold">{service.trust.status}</p>
            </div>
          </div>
          <p className="mt-6 max-w-3xl text-base leading-7 text-muted-foreground">
            {service.description || "Die öffentliche Quelle liefert keine Beschreibung."}
          </p>
          <section className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border/60 bg-card/50 p-5">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Quelle</p>
              <p className="mt-2 font-semibold">{service.discovery.sourceLabel}</p>
              <a href={service.discovery.evidence.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-primary hover:underline">{service.discovery.evidence.sourceUrl}</a>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card/50 p-5">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Verifikation</p>
              <p className="mt-2 font-semibold">{service.verification.status}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Persistierte Quelldaten ohne Bond402-Liveprüfung und ohne Sicherheitsgarantie.</p>
            </div>
          </section>
          <p className="mt-6 text-xs leading-5 text-muted-foreground">
            Entdeckt: {new Date(service.discovery.evidence.discoveredAt).toLocaleString("de-DE")} · Provider: {service.discovery.evidence.provider || "Nicht angegeben"} · Version: {service.discovery.evidence.version || "Nicht angegeben"}
          </p>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <Link href="/catalog" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Zum Katalog</Link>
      {error ? <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">{error}</div> : service ? <div className="mt-8 max-w-4xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><Badge variant="outline">Öffentlich gelistet</Badge><h1 className="mt-3 text-3xl font-bold tracking-tight">{service.name}</h1><a href={service.url} target="_blank" rel="noreferrer" className="mt-2 block break-all font-mono text-sm text-primary hover:underline">{service.url}</a></div><div className="rounded-2xl border border-border/60 bg-card/60 p-5 text-center"><p className="text-xs uppercase tracking-widest text-muted-foreground">Trust Score</p><p className="mt-1 text-4xl font-bold">{service.trustScore === null ? "—" : service.trustScore}</p><p className="text-xs text-muted-foreground">von 100</p></div></div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-card/50 p-5"><ShieldAlert className="h-5 w-5 text-primary" /><h2 className="mt-3 font-semibold">Maschinenlesbar</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Trust Score, Prüfstatus, Frische und Entscheidung sind über die Public API abrufbar.</p></div>
          <div className="rounded-2xl border border-border/60 bg-card/50 p-5"><Timer className="h-5 w-5 text-primary" /><h2 className="mt-3 font-semibold">Historie</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{service.trustMetrics.sampleCount} Livechecks · p95 {service.trustMetrics.p95ResponseTimeMs ?? "—"} ms · p99 {service.trustMetrics.p99ResponseTimeMs ?? "—"} ms</p></div>
          <div className="rounded-2xl border border-border/60 bg-card/50 p-5"><CheckCircle2 className="h-5 w-5 text-primary" /><h2 className="mt-3 font-semibold">Zugriff</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Public Pre-Action ist lesbar. Eine neue Live-Prüfung bleibt owner- und Developer-Key-geschützt.</p></div>
        </div>
        <section className="mt-8 rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-xl font-semibold">Prüfbare Trust-Signale</h2><p className="mt-1 text-sm text-muted-foreground">Diese Zustände beschreiben gespeicherte Beobachtungen, keine Sicherheitsgarantie.</p></div>
            <Badge variant="outline">{service.domainVerification.status === "VERIFIED" ? "Domain verifiziert" : "Domain nicht verifiziert"}</Badge>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["HTTPS", service.signals.https],
              ["TLS/Zertifikat", service.signals.tls],
              ["Security-Header", service.signals.securityHeaders],
              ["Uptime", service.trustMetrics.uptimePercent === null ? "NOT_EVALUATED" : `${service.trustMetrics.uptimePercent}% beobachtet`],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-border/60 bg-background/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value.length > 20 ? value : signalLabel(value)}</p></div>)}
          </div>
           <div className="mt-4 rounded-xl border border-border/60 bg-background/50 p-4">
             <div className="flex flex-wrap items-center justify-between gap-3">
               <div>
                 <p className="text-xs uppercase tracking-wider text-muted-foreground">Regionale Beobachtungen</p>
                 <p className="mt-1 font-semibold">{regionalStateLabel(service.trustMetrics.regionalAggregation.state)}</p>
               </div>
               <Badge variant="outline">{service.trustMetrics.regionalAggregation.regionCount} Region{service.trustMetrics.regionalAggregation.regionCount === 1 ? "" : "en"}</Badge>
             </div>
             <p className="mt-3 text-sm leading-6 text-muted-foreground">{service.trustMetrics.regionalAggregation.description}</p>
             <p className="mt-2 text-xs leading-5 text-muted-foreground">
               Beobachtungsbasis: gespeicherte Livechecks · Kontinuierliche Mehrregionen-Überwachung: nein.
             </p>
           </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">{service.trustMetrics.weighting.description} Uptime und Latenz beziehen sich nur auf gespeicherte Bond402-Livechecks im sichtbaren Beobachtungsfenster.</p>
        </section>
        <section className="mt-8 rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="text-xl font-semibold">Pre-Action-Entscheidung</h2><p className="mt-1 text-sm text-muted-foreground">Gespeicherte Trust-Daten für den gewählten Aktionskontext.</p></div><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={context} onChange={(event) => setContext(event.target.value)}><option value="GENERAL">Allgemein</option><option value="READ">Lesen</option><option value="WRITE">Schreiben</option><option value="PAYMENT">Zahlung</option><option value="CREDENTIAL_USE">Zugangsdaten verwenden</option></select></div>{decision && <div className="mt-5"><Badge variant={decisionVariant(decision.decision)} className="text-sm">{decision.decision}</Badge><ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">{decision.reasons.map((reason) => <li key={reason}>• {reason}</li>)}</ul><p className="mt-4 text-xs text-muted-foreground">Policy {decision.policy.version} · Datenstatus {decision.freshness.state}{decision.freshness.ageSeconds === null ? "" : ` · ${Math.floor(decision.freshness.ageSeconds / 3600)} h alt`}</p></div>}</section>
        <p className="mt-8 text-xs leading-5 text-muted-foreground">Öffentliche Antworten enthalten keine Kontodaten, Besitzerinformationen, API-Schlüssel oder internen Prüfdetails. Die API ist auf 60 Anfragen pro Minute und IP begrenzt.</p>
      </div> : <div className="mt-8 h-64 animate-pulse rounded-2xl bg-muted/50" />}
    </PublicLayout>
  );
}

function ExternalDiscoveryDetailView({ service }: { service: ExternalDiscoveryDetail }) {
  const { user } = useAuth();
  const candidates = service.safeEndpoints?.length
    ? service.safeEndpoints
    : service.safeEndpoint
      ? [service.safeEndpoint]
      : [];
  const [selectedCandidateKey, setSelectedCandidateKey] = useState(
    candidates[0] ? `${candidates[0].method}:${candidates[0].path}:${candidates[0].url}` : "",
  );
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<ExternalCheckResult | null>(null);
  const [selectedServerUrl, setSelectedServerUrl] = useState(
    service.specification.servers.find((server) => !server.templated && server.url.startsWith("https://"))?.url ?? "",
  );

  useEffect(() => {
    const first = candidates[0];
    setSelectedCandidateKey(first ? `${first.method}:${first.path}:${first.url}` : "");
    setSelectedServerUrl(
      service.specification.servers.find((server) => !server.templated && server.url.startsWith("https://"))?.url ?? "",
    );
    setCheckResult(null);
    setCheckError(null);
  }, [service.id, service.specification.servers]);

  const selectedCandidate = candidates.find(
    (candidate) => `${candidate.method}:${candidate.path}:${candidate.url}` === selectedCandidateKey,
  ) ?? null;
  const safeServers = service.specification.servers.filter(
    (server) => !server.templated && server.url.startsWith("https://"),
  );
  const selectedServer = safeServers.find((server) => server.url === selectedServerUrl) ?? null;
  const authLabel = service.specification.auth.status === "REQUIRED"
    ? "Authentifizierung erforderlich"
    : service.specification.auth.status === "NOT_REQUIRED"
      ? "Explizit ohne Auth-Anforderung beschrieben"
      : service.specification.auth.status === "NOT_DECLARED"
        ? "Nicht in der Spezifikation erklärt"
        : "Unbekannt";
  const importUrl = selectedCandidate?.url ?? selectedServer?.url ?? null;
  const canImport = Boolean(importUrl);
  const registerMetadata = JSON.stringify({
    sourceRecordUrl: service.source.recordUrl,
    specificationUrl: service.source.specificationUrl,
    provider: service.provider,
    version: service.version,
    authSchemes: service.specification.auth.schemes.map((scheme) => ({
      name: scheme.name,
      type: scheme.type,
      scheme: scheme.scheme,
      location: scheme.location,
    })),
  });
  const registerHref = importUrl
    ? `/dashboard?registerUrl=${encodeURIComponent(importUrl)}&registerName=${encodeURIComponent(service.name)}&registerMethod=${encodeURIComponent(selectedCandidate?.method ?? "HEAD")}&registerSourceType=EXTERNAL_DISCOVERY&registerProvider=${encodeURIComponent(service.provider)}&registerSourceUrl=${encodeURIComponent(service.source.specificationUrl)}&registerAuthRequirement=${encodeURIComponent(service.specification.auth.status)}&registerDiscoveryMetadata=${encodeURIComponent(registerMetadata)}#service-registration`
    : null;
  const signInHref = registerHref ? `/sign-in?returnTo=${encodeURIComponent(registerHref)}` : null;
  const importActionHref = user ? registerHref : signInHref;

  async function runSafeCheck() {
    if (!selectedCandidate || isChecking) return;
    setIsChecking(true);
    setCheckError(null);
    setCheckResult(null);
    try {
      const response = await fetch(`${apiBase}/public/services/${encodeURIComponent(service.id)}/external-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedCandidate),
      });
      const data = await response.json().catch(() => null) as ExternalCheckResult | { error?: string } | null;
      if (!response.ok) {
        throw new Error(data && "error" in data && data.error ? data.error : "Die sichere Prüfung konnte nicht gestartet werden.");
      }
      setCheckResult(data as ExternalCheckResult);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Die sichere Prüfung konnte nicht abgeschlossen werden.");
    } finally {
      setIsChecking(false);
    }
  }

  async function runPreflight() {
    if (isChecking) return;
    setIsChecking(true);
    setCheckError(null);
    setCheckResult(null);
    try {
      const response = await fetch(`${apiBase}/public/services/${encodeURIComponent(service.id)}/external-preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedServerUrl ? { serverUrl: selectedServerUrl } : {}),
      });
      const data = await response.json().catch(() => null) as ExternalCheckResult | { error?: string } | null;
      if (!response.ok) {
        throw new Error(data && "error" in data && data.error ? data.error : "Der sichere Preflight konnte nicht gestartet werden.");
      }
      setCheckResult(data as ExternalCheckResult);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "Der sichere Preflight konnte nicht abgeschlossen werden.");
    } finally {
      setIsChecking(false);
    }
  }

  const hasSafeCandidate = Boolean(selectedCandidate);
  return (
    <div className="mt-8 flex max-w-5xl flex-col">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <Badge variant="secondary">Externe Discovery · unverifiziert</Badge>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{service.name}</h1>
           <p className="mt-2 font-mono text-sm text-muted-foreground">{service.provider} · Version {service.version ?? "Nicht angegeben"}</p>
        </div>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 sm:max-w-xs">
          <p className="text-xs uppercase tracking-widest text-amber-700 dark:text-amber-300">Verifikationsstatus</p>
          <p className="mt-2 font-semibold">UNVERIFIED_EXTERNAL</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Bond402 hat diesen externen Treffer nicht live geprüft und vergibt keinen Trust Score.</p>
        </div>
      </div>

      <p className="order-3 mt-6 max-w-3xl text-base leading-7 text-muted-foreground">
        {service.description || "Die externe Quelle liefert keine Beschreibung."}
      </p>

      <section className="order-2 sticky top-[4.25rem] z-10 mt-6 rounded-2xl border border-primary/30 bg-background/95 p-4 shadow-lg shadow-black/5 backdrop-blur sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={hasSafeCandidate ? "outline" : "secondary"}>
                {hasSafeCandidate ? "Sicherer Prüf-Kandidat" : "Sicherer Preflight"}
              </Badge>
              {service.specification.auth.status === "REQUIRED" && (
                <Badge variant="outline">Auth erforderlich</Badge>
              )}
            </div>
            <h2 className="mt-2 text-xl font-semibold">
              {hasSafeCandidate ? "API sicher prüfen" : "API ohne Auth-Funktionsaufruf prüfen"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {hasSafeCandidate
                ? "Bond402 ruft nur den ausgewählten, explizit öffentlichen GET/HEAD-Endpunkt read-only auf."
                : "Bond402 führt nur sichere Preflight-/Sandbox-Prüfungen am bekannten HTTPS-Server aus. Es wird kein authentifizierter API-Funktionsaufruf durchgeführt und kein Token erraten."}
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 lg:w-64">
            {hasSafeCandidate ? candidates.length > 1 && (
              <select
                aria-label="Sicheres Prüfziel auswählen"
                value={selectedCandidateKey}
                onChange={(event) => {
                  setSelectedCandidateKey(event.target.value);
                  setCheckResult(null);
                  setCheckError(null);
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {candidates.map((candidate) => (
                  <option key={`${candidate.method}:${candidate.path}:${candidate.url}`} value={`${candidate.method}:${candidate.path}:${candidate.url}`}>
                    {candidate.method} {candidate.path}
                  </option>
                ))}
              </select>
            ) : safeServers.length > 1 ? (
              <select
                aria-label="Bekannten HTTPS-Server auswählen"
                value={selectedServerUrl}
                onChange={(event) => {
                  setSelectedServerUrl(event.target.value);
                  setCheckResult(null);
                  setCheckError(null);
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {safeServers.map((server) => <option key={server.url} value={server.url}>{server.url}</option>)}
              </select>
            ) : null}
            <Button onClick={hasSafeCandidate ? runSafeCheck : runPreflight} disabled={isChecking} className="w-full gap-2">
              {isChecking ? "Wird sicher geprüft …" : hasSafeCandidate ? "Sicher prüfen" : "In Sandbox prüfen"}
              {!isChecking && <CheckCircle2 className="h-4 w-4" />}
            </Button>
            {importActionHref ? (
              <Button asChild variant="outline" className="w-full gap-2">
                <Link href={importActionHref}>
                  Zu meinen Diensten hinzufügen
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled className="w-full gap-2">
                Kein eindeutiges Prüfziel zum Import
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-border/60 bg-card/60 p-3 text-xs leading-5 text-muted-foreground">
          <p className="font-medium text-foreground">
            {hasSafeCandidate ? `${selectedCandidate?.method} ${selectedCandidate?.path}` : selectedServerUrl || "Kein sicherer Server erkannt"}
          </p>
          <p className="mt-1">
            {hasSafeCandidate ? service.safeEndpointNote : "Der Preflight bewertet DNS/Host, HTTPS/TLS, Redirects, Header und erreichbare Antwortmerkmale soweit ohne Authentifizierung möglich."}
          </p>
        </div>
        {checkError && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{checkError}</p>}
        {!canImport && (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-5 text-amber-800 dark:text-amber-200">
            Die externe Spezifikation nennt kein eindeutig ableitbares, öffentliches HTTPS-Ziel. Bond402 öffnet deshalb nicht die Quell- oder Spezifikations-URL und rät kein Prüfziel.
          </p>
        )}
        {checkResult && <ExternalCheckResultView result={checkResult} />}
      </section>

      <div className="order-4 mt-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-card/50 p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Quelle</p>
          <p className="mt-2 font-semibold">{service.source.label}</p>
          <a href={service.source.recordUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-primary hover:underline">Katalogeintrag öffnen</a>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/50 p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">OpenAPI</p>
          <p className="mt-2 font-semibold">{service.specification.openapiVersion || "Nicht angegeben"}</p>
          <p className="mt-2 text-sm text-muted-foreground">{service.specification.status === "PARSED" ? "Spezifikation passiv gelesen" : "Spezifikation nicht vollständig lesbar"}</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/50 p-5">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Auth</p>
          <p className="mt-2 font-semibold">{authLabel}</p>
          <p className="mt-2 text-sm text-muted-foreground">{service.specification.auth.schemes.length ? service.specification.auth.schemes.map((scheme) => scheme.name).join(", ") : "Keine benannten Schemes"}</p>
        </div>
      </div>

      {!service.safeEndpoint && !service.safeEndpoints.length && (
        <div className="order-5 mt-8 rounded-2xl border border-border/60 bg-card/50 p-5 text-sm leading-6 text-muted-foreground">
          {service.safeEndpointNote}
        </div>
      )}

      <section className="order-6 mt-8 rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Bekannte Server</h2>
            <p className="mt-1 text-sm text-muted-foreground">Nur deklarierte Server aus der externen Spezifikation; keine Erreichbarkeitsgarantie.</p>
          </div>
          <Badge variant="outline">{service.specification.servers.length}</Badge>
        </div>
        {service.specification.servers.length ? (
          <ul className="mt-5 space-y-3">
            {service.specification.servers.map((server) => (
              <li key={server.url} className="rounded-xl border border-border/60 bg-background/50 p-3">
                <p className="break-all font-mono text-sm">{server.url}</p>
                <p className="mt-1 text-xs text-muted-foreground">{server.templated ? "Enthält Variablen; nicht als Prüfziel verwendet." : server.description || "Keine Serverbeschreibung angegeben."}</p>
              </li>
            ))}
          </ul>
        ) : <p className="mt-5 text-sm text-muted-foreground">Keine sicher lesbaren Serverangaben gefunden.</p>}
      </section>

      <section className="order-7 mt-8 rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Bekannte Endpoints</h2>
            <p className="mt-1 text-sm text-muted-foreground">Passiv aus der Spezifikation gelesen. Bond402 führt daraus keine Anfrage automatisch aus.</p>
          </div>
          <Badge variant="outline">{service.specification.endpoints.length}</Badge>
        </div>
        {service.specification.endpoints.length ? (
          <div className="mt-5 space-y-3">
            {service.specification.endpoints.map((endpoint) => (
              <div key={`${endpoint.method}:${endpoint.path}`} className="rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{endpoint.method}</Badge>
                  <span className="break-all font-mono text-sm">{endpoint.path}</span>
                  {endpoint.safeToProbe && <Badge variant="secondary">öffentlicher Kandidat</Badge>}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{endpoint.summary || "Keine Kurzbeschreibung"} · {endpoint.auth === "REQUIRED" ? "Auth erforderlich" : endpoint.auth === "NOT_REQUIRED" ? "ohne Auth-Anforderung" : "Auth nicht sicher geklärt"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{endpoint.reason}</p>
              </div>
            ))}
          </div>
        ) : <p className="mt-5 text-sm text-muted-foreground">Keine Endpoints sicher ausgelesen.</p>}
      </section>

      <p className="order-8 mt-8 text-xs leading-5 text-muted-foreground">
        <a href={service.source.specificationUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Originale Spezifikation öffnen</a>. Sie wird von Bond402 nur begrenzt gelesen und als Daten behandelt; fremder JavaScript-, Binär- oder Shell-Code wird nicht ausgeführt.
      </p>
    </div>
  );
}

type ExternalCheckResult = {
  mode?: "PREFLIGHT" | "PASSIVE_ONLY";
  serverUrl?: string | null;
  endpoint?: { method: "GET" | "HEAD"; path: string; url: string };
  verification: {
    status: "CHECKED_EXTERNAL";
    trustStatus: "UNVERIFIED_EXTERNAL";
    checkedAt: string;
    persisted: false;
  };
  check: {
    status: "PASS" | "FAIL" | "REVIEW";
    classification: string;
    availabilityImpact: string;
    summary: string;
    reachable: boolean;
    responseTimeMs: number;
    httpStatus: number | null;
    errorCode: string | null;
    https: boolean;
    tlsStatus: string;
    securitySignals: {
      reachability: { status: string; summary: string };
      transport: { status: string; summary: string };
      network: { status: string; summary: string };
      redirects: { status: string; summary: string };
      responseType: { status: string; summary: string; kind: string };
      suspiciousPayload: { status: string; summary: string; indicators: string[] };
      securityConfidence: { status: string; summary: string; score: number | null };
      authentication: { status: string; summary: string; required: boolean };
      rateLimit: { status: string; summary: string; detected: boolean };
    };
  };
  safety: {
    requestWasReadOnly: boolean;
    executedMethod: string | null;
    authenticatedRequest?: boolean;
    secretsSent: boolean;
    foreignCodeExecuted: boolean;
    responsePersisted: boolean;
    note: string;
  };
};

function ExternalCheckResultView({ result }: { result: ExternalCheckResult }) {
  const signalRows = [
    ["Erreichbarkeit", result.check.securitySignals.reachability],
    ["Transport / TLS", result.check.securitySignals.transport],
    ["Netzwerkziel", result.check.securitySignals.network],
    ["Redirects", result.check.securitySignals.redirects],
    ["Antworttyp", result.check.securitySignals.responseType],
    ["Threat-Heuristiken", result.check.securitySignals.suspiciousPayload],
    ["Security Confidence", result.check.securitySignals.securityConfidence],
  ] as const;
  return (
    <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge variant={result.check.status === "PASS" ? "secondary" : "warning"}>Bond402-Prüfung abgeschlossen</Badge>
          <p className="mt-2 text-sm font-semibold">
            {result.check.status} · {checkClassificationLabel(result.check.classification)} · HTTP {result.check.httpStatus ?? "nicht erreicht"}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{result.check.summary}</p>
        </div>
        <p className="text-xs text-muted-foreground">{result.check.responseTimeMs} ms · {new Date(result.verification.checkedAt).toLocaleString("de-CH")}</p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {signalRows.map(([label, signal]) => (
          <div key={label} className="rounded-lg border border-border/60 bg-background/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{label}</span>
              <Badge variant="outline">{signal.status}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{signal.summary}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        {result.safety.note} Authentifizierungsfehler oder Rate-Limits sind keine Malware-Erkennung. Diese einzelne öffentliche Beobachtung hebt den Status nicht zu einer Sicherheitsgarantie an; der Treffer bleibt UNVERIFIED_EXTERNAL.
      </p>
    </div>
  );
}