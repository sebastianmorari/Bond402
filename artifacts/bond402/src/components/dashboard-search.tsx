import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronRight,
  ExternalLink,
  Globe2,
  KeyRound,
  Link2,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  getSearchPublicServicesQueryKey,
  useListServices,
  useSearchPublicServices,
} from "@workspace/api-client-react";
import type {
  ApiService,
  PublicExternalService,
  PublicInternalDiscovery,
  PublicServiceCatalog,
  PublicServiceSearchResult,
} from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { checkStatusLabel } from "@/lib/presentation";

interface DashboardSearchProps {
  onSelectService: (id: string) => void;
}

type PublicCatalogItem = PublicServiceCatalog["items"][number];

const LOCAL_RELEVANCE_THRESHOLD = 50;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de-CH")
    .trim();
}

function getLocalScore(service: ApiService, query: string) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 1;

  const name = normalize(service.name);
  const url = normalize(service.url);
  const combined = `${name} ${url}`;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  if (!tokens.every((token) => combined.includes(token))) return 0;

  let score = 45;
  if (name === normalizedQuery || url === normalizedQuery) score = 100;
  else if (name.startsWith(normalizedQuery)) score = 82;
  else if (name.includes(normalizedQuery)) score = 68;
  else if (url.includes(normalizedQuery)) score = 58;

  return score;
}

function isExternalService(item: PublicCatalogItem): item is PublicExternalService {
  return "kind" in item && item.kind === "EXTERNAL_DISCOVERY";
}

function isPersistedDiscovery(item: PublicCatalogItem): item is PublicInternalDiscovery {
  return "kind" in item && item.kind === "INTERNAL_DISCOVERY";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Noch nicht geprüft";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt unbekannt";

  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function getStatusVariant(status: string | null | undefined): "success" | "destructive" | "warning" | "secondary" {
  if (status === "PASS") return "success";
  if (status === "FAIL") return "destructive";
  if (status === "REVIEW") return "warning";
  return "secondary";
}

function LocalServiceResult({
  service,
  onSelect,
}: {
  service: ApiService;
  onSelect: (id: string) => void;
}) {
  const latestCheck = service.checks[0];
  const status = latestCheck?.status;
  const verificationLabel = service.domainVerification.status === "VERIFIED"
    ? "Domain verifiziert"
    : service.domainVerification.status === "PENDING"
      ? "Domain ausstehend"
      : "Domain nicht verifiziert";

  return (
    <div className="group rounded-lg border border-border/70 bg-background/45 p-3 transition-colors hover:border-primary/45 hover:bg-card">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-semibold tracking-tight">{service.name}</h4>
            <Badge variant="outline" className="gap-1 border-primary/25 bg-primary/5 text-[10px] uppercase tracking-[0.08em] text-primary">
              <KeyRound className="h-3 w-3" aria-hidden="true" />
              Ihre Instanz
            </Badge>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={service.url}>
            {service.url}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              Quelle: Bond402
            </span>
            <span className="inline-flex items-center gap-1">
              <Globe2 className="h-3 w-3" aria-hidden="true" />
              {verificationLabel}
            </span>
            {service.trustScore !== null && (
              <span className="font-mono text-foreground/75">
                Trust {service.trustScore}%
              </span>
            )}
            {latestCheck && (
              <span>Prüfung {formatDate(latestCheck.checkedAt)}</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant={getStatusVariant(status)} className="text-[10px]">
            {status ? checkStatusLabel(status) : "Nicht geprüft"}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onSelect(service.id)}
            aria-label={`${service.name} öffnen und prüfen`}
          >
            Prüfen
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PublicCatalogResult({
  item,
}: {
  item: PublicServiceSearchResult | PublicInternalDiscovery;
}) {
  const latestCheck = "latestCheck" in item ? item.latestCheck : null;
  const detailHref = "links" in item ? item.links.detail : item.url;
  const label = isPersistedDiscovery(item) ? "Persistierte Discovery" : "Öffentlicher Katalog";

  return (
    <div className="rounded-lg border border-border/70 bg-background/45 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-sky-500/20 bg-sky-500/10">
          <Globe2 className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-semibold tracking-tight">{item.name}</h4>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-[0.08em]">
              {label}
            </Badge>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={item.url}>
            {item.url}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>Quelle: {item.discovery.sourceLabel}</span>
            <span>Match {Math.round(item.discovery.matchScore)}%</span>
            <span>
              Verifikation: {latestCheck?.status ? checkStatusLabel(latestCheck.status) : "Keine Prüfung"}
            </span>
            {"trustScore" in item && item.trustScore !== null && (
              <span className="font-mono text-foreground/75">Trust {item.trustScore}%</span>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          asChild
        >
          <a
            href={detailHref}
            target="_blank"
            rel="noreferrer"
            aria-label={`${item.name}: öffentlichen Bond402-Eintrag öffnen`}
          >
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </Button>
      </div>
    </div>
  );
}

function ExternalResult({ item }: { item: PublicExternalService }) {
  return (
    <div className="rounded-lg border border-warning/35 bg-warning/5 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-warning/30 bg-warning/10">
          <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-semibold tracking-tight">{item.name}</h4>
            <Badge variant="warning" className="font-mono text-[10px] tracking-[0.05em]">
              UNVERIFIED_EXTERNAL
            </Badge>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={item.url}>
            {item.url}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>Quelle: {item.discovery.sourceLabel}</span>
            <span>Provider: {item.discovery.evidence.provider}</span>
            <span>Match {Math.round(item.discovery.matchScore)}%</span>
            {item.discovery.evidence.openapiVersion && (
              <span>OpenAPI {item.discovery.evidence.openapiVersion}</span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-warning-foreground/80">
            Nur Quellmetadaten. Bond402 hat diesen Dienst nicht verifiziert.
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" asChild>
            <a
              href={`/catalog/${encodeURIComponent(item.id)}`}
              aria-label={`${item.name}: Bond402-Detail öffnen`}
            >
              Details
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </a>
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-muted-foreground" asChild>
            <a
              href={item.links.sourceRecord}
              target="_blank"
              rel="noreferrer"
              aria-label={`${item.name}: Quelleneintrag in neuem Tab öffnen`}
            >
              Quelleneintrag
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DashboardSearch({ onSelectService }: DashboardSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const {
    data: services,
    isLoading: servicesLoading,
    isError: servicesError,
    refetch: refetchServices,
  } = useListServices();

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 180);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        setQuery("");
        inputRef.current?.blur();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const localResults = useMemo(() => {
    if (!services) return [];

    if (!query.trim()) {
      return services.map((service) => ({ service, score: 1 }));
    }

    return services
      .map((service) => ({ service, score: getLocalScore(service, query) }))
      .filter(({ score }) => score >= LOCAL_RELEVANCE_THRESHOLD)
      .sort((left, right) => right.score - left.score);
  }, [query, services]);

  const shouldSearchPublic = Boolean(
    debouncedQuery &&
    (!servicesLoading && (servicesError || localResults.length === 0)),
  );
  const publicParams = useMemo(
    () => (shouldSearchPublic
      ? { q: debouncedQuery, page: 1, pageSize: 8 }
      : undefined),
    [debouncedQuery, shouldSearchPublic],
  );
  const {
    data: publicCatalog,
    isLoading: publicLoading,
    isFetching: publicFetching,
    isError: publicError,
    refetch: refetchPublic,
  } = useSearchPublicServices(publicParams, {
    query: {
      enabled: shouldSearchPublic,
      queryKey: getSearchPublicServicesQueryKey(publicParams),
    },
  });

  const publicItems = publicCatalog?.items ?? [];
  const showLocal = !servicesLoading && localResults.length > 0;
  const showPublic = shouldSearchPublic && !publicLoading && publicItems.length > 0;
  const hasSearch = Boolean(query.trim());
  const searchingPublic = shouldSearchPublic && (publicLoading || publicFetching);

  return (
    <Card className="overflow-hidden border-border/70 bg-card/70 shadow-sm">
      <CardHeader className="border-b border-border/60 bg-muted/15 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
            <Search className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <CardTitle className="text-base">Dienste suchen</CardTitle>
              <Badge variant="outline" className="gap-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                Trust Discovery
              </Badge>
            </div>
            <CardDescription className="mt-1 max-w-2xl text-xs leading-relaxed">
              Ihre registrierten Dienste werden zuerst lokal abgeglichen. Nur bei fehlendem Treffer wird der öffentliche Katalog befragt.
            </CardDescription>
          </div>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
                inputRef.current?.blur();
              }
            }}
            placeholder="Name oder URL durchsuchen …"
            aria-label="Registrierte und öffentliche Dienste durchsuchen"
            className="h-11 bg-background/75 pl-9 pr-24"
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-12 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Suche leeren"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
          <Kbd className="absolute right-2 top-1/2 -translate-y-1/2 bg-muted/80 text-[10px]">⌘ K</Kbd>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-4 py-4 sm:px-5">
        {servicesLoading ? (
          <div className="space-y-2" aria-label="Registrierte Dienste werden geladen" aria-busy="true">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="flex items-start gap-3 rounded-lg border border-border/50 p-3">
                <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        ) : servicesError && !hasSearch ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Eigene Dienste nicht verfügbar</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>Die Suche kann den registrierten Katalog gerade nicht lesen.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => refetchServices()}>
                Erneut versuchen
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {showLocal ? (
          <section aria-labelledby="dashboard-search-local-heading" className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 id="dashboard-search-local-heading" className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                  {hasSearch ? "Eigene Treffer" : "Ihre Dienste"}
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Direkt aus Ihrem Bond402-Konto
                </p>
              </div>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {localResults.length}
              </Badge>
            </div>
            <div className="space-y-2">
              {localResults.map(({ service }) => (
                <LocalServiceResult key={service.id} service={service} onSelect={onSelectService} />
              ))}
            </div>
          </section>
        ) : null}

        {searchingPublic ? (
          <section aria-label="Öffentliche Suche wird geladen" aria-busy="true" className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-4 w-8" />
            </div>
            <Skeleton className="h-[92px] w-full rounded-lg" />
          </section>
        ) : null}

        {showPublic ? (
          <section aria-labelledby="dashboard-search-public-heading" className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 id="dashboard-search-public-heading" className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                  Öffentliche Treffer
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Bond402-Katalog und gekennzeichnete externe Quellen
                </p>
              </div>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {publicItems.length}
              </Badge>
            </div>
            <div className="space-y-2">
              {publicItems.map((item) => (
                isExternalService(item)
                  ? <ExternalResult key={`${item.kind}-${item.id}`} item={item} />
                  : <PublicCatalogResult key={item.id} item={item} />
              ))}
            </div>
          </section>
        ) : null}

        {publicError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Öffentliche Suche nicht verfügbar</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>Der öffentliche Katalog konnte nicht geladen werden.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => refetchPublic()}>
                Erneut versuchen
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {hasSearch && !servicesLoading && !searchingPublic && !showLocal && !showPublic && !publicError ? (
          <Empty className="border border-dashed border-border/70 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Keine passenden Dienste</EmptyTitle>
              <EmptyDescription>
                Für „{query.trim()}“ wurde weder in Ihren Diensten noch im öffentlichen Katalog ein Treffer gefunden.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {!hasSearch && !servicesLoading && !servicesError && localResults.length === 0 ? (
          <Empty className="border border-dashed border-border/70 py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Check className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Noch keine eigenen Dienste</EmptyTitle>
              <EmptyDescription>
                Registrieren Sie einen Dienst, um ihn hier mit Trust-Signalen und Live-Prüfungen zu finden.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {hasSearch && servicesError && !searchingPublic && !showPublic && !publicError ? (
          <p className={cn("text-center text-xs text-muted-foreground", showLocal && "hidden")}>
            Die Suche nach eigenen Diensten ist derzeit eingeschränkt. Es wurden keine öffentlichen Treffer gefunden.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
