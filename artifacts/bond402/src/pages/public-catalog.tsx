import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Bot, CheckCircle2, Search, Shield, ShieldAlert, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublicFooter } from "@/components/public-footer";

const apiBase = `${window.location.origin}/api`;

type PublicService = {
  id: string;
  name: string;
  url: string;
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
    probeRegion: string;
  } | null;
  access: { preActionRequiresDeveloperKey: boolean; liveCheckRequiresDeveloperKey: boolean };
};

type CatalogResponse = {
  items: PublicService[];
  query: string;
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
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
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Die öffentlichen Daten konnten nicht geladen werden.");
  return body as T;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Die öffentlichen Daten konnten nicht geladen werden.");
  return body as T;
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
        <Badge variant={service.latestStatus === "PASS" ? "default" : service.latestStatus === "FAIL" ? "destructive" : "outline"}>{service.latestStatus || "Neu"}</Badge>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Trust Score</p><p className="mt-1 text-xl font-bold">{service.trustScore === null ? "—" : `${service.trustScore}%`}</p></div>
        <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Beobachtete Uptime</p><p className="mt-1 font-medium">{service.trustMetrics.uptimePercent === null ? "Noch keine" : `${service.trustMetrics.uptimePercent}%`}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">HTTPS: {signalLabel(service.signals.https)}</Badge>
        <Badge variant="outline">TLS: {signalLabel(service.signals.tls)}</Badge>
        <Badge variant="outline">Domain: {signalLabel(service.domainVerification.status === "VERIFIED" ? "CHECKED" : service.domainVerification.status === "NOT_EVALUATED" ? "NOT_EVALUATED" : "WARNING")}</Badge>
        <Badge variant="outline">Regionen: {regionalStateLabel(service.trustMetrics.regionalAggregation.state)}</Badge>
      </div>
      <p className="mt-4 line-clamp-2 text-sm leading-6 text-muted-foreground">{service.trustExplanation}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">Trust-Daten öffnen <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
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

  useEffect(() => {
    let active = true;
    setLoading(true);
    getJson<CatalogResponse>(`/public/services?q=${encodeURIComponent(submittedQuery)}&page=${page}&pageSize=12`)
      .then((result) => { if (active) { setData(result); setError(""); } })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [submittedQuery, page]);

  return (
    <PublicLayout>
      <section className="max-w-3xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"><Bot className="h-4 w-4" /> Operator-freigegebenes Verzeichnis</div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Öffentliche Trust-Daten für AI Agents</h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">Dieses Verzeichnis enthält ausschließlich Dienste, die vom jeweiligen Betreiber ausdrücklich gelistet wurden. Es ist keine universelle Suchmaschine. ALLOW ist eine Risikoeinschätzung, keine Sicherheitsgarantie.</p>
      </section>
      <form className="mt-8 flex max-w-2xl gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dienstname oder API-URL suchen" aria-label="Katalog durchsuchen" />
        <Button type="submit"><Search className="mr-2 h-4 w-4" />Suchen</Button>
      </form>
      {error && <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
      <div className="mt-10 flex items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">Gelistete Dienste</h2><p className="mt-1 text-sm text-muted-foreground">{data ? `${data.total} öffentliche Einträge` : "Öffentliche Einträge werden geladen"}</p></div><a href={`${apiBase}/openapi.json`} className="hidden text-sm font-medium text-primary hover:underline sm:block">OpenAPI JSON</a></div>
      {loading ? <div className="mt-6 grid gap-4 md:grid-cols-2"><div className="h-48 animate-pulse rounded-2xl bg-muted/50" /><div className="h-48 animate-pulse rounded-2xl bg-muted/50" /></div> : data?.items.length ? <div className="mt-6 grid gap-4 md:grid-cols-2">{data.items.map((service) => <ServiceCard key={service.id} service={service} />)}</div> : <div className="mt-6 rounded-2xl border border-dashed border-border/70 p-12 text-center text-muted-foreground">Noch keine Dienste entsprechen dieser Suche.</div>}
      <div className="mt-8 flex items-center justify-between"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ArrowLeft className="mr-2 h-4 w-4" />Zurück</Button><span className="text-sm text-muted-foreground">Seite {page}</span><Button variant="outline" disabled={!data?.hasNextPage} onClick={() => setPage((value) => value + 1)}>Weiter<ArrowRight className="ml-2 h-4 w-4" /></Button></div>
    </PublicLayout>
  );
}

export function PublicServicePage() {
  const [, params] = useRoute<{ id: string }>("/catalog/:id");
  const id = params?.id || "";
  const [service, setService] = useState<PublicService | null>(null);
  const [decision, setDecision] = useState<DecisionResponse | null>(null);
  const [context, setContext] = useState("GENERAL");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getJson<PublicService>(`/public/services/${encodeURIComponent(id)}`),
      getJson<DecisionResponse>(`/public/services/${encodeURIComponent(id)}/pre-action-check`),
    ]).then(([serviceResult, decisionResult]) => { setService(serviceResult); setDecision(decisionResult); }).catch((reason: Error) => setError(reason.message));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    postJson<DecisionResponse>(`/public/services/${encodeURIComponent(id)}/pre-action-check`, { actionContext: context })
      .then(setDecision)
      .catch(() => undefined);
  }, [context, id]);

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