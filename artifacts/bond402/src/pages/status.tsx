import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, Clock3, Database, RefreshCw, Server, Shield, TriangleAlert, XCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PublicFooter } from "@/components/public-footer";

type SignalState = "checking" | "operational" | "unavailable";

type Signal = {
  state: SignalState;
  detail: string;
  checkedAt: string | null;
};

type StatusSignals = {
  frontend: Signal;
  api: Signal;
  database: Signal;
};

const initialSignals: StatusSignals = {
  frontend: {
    state: "operational",
    detail: "Diese Statusseite konnte geladen werden.",
    checkedAt: null,
  },
  api: { state: "checking", detail: "Prüfung läuft …", checkedAt: null },
  database: { state: "checking", detail: "Prüfung läuft …", checkedAt: null },
};

function signalLabel(state: SignalState) {
  if (state === "operational") return "Betriebsbereit";
  if (state === "unavailable") return "Eingeschränkt";
  return "Wird geprüft";
}

function SignalIcon({ state }: { state: SignalState }) {
  if (state === "operational") return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (state === "unavailable") return <XCircle className="h-5 w-5 text-destructive" />;
  return <RefreshCw className="h-5 w-5 animate-spin text-primary" />;
}

function SignalCard({
  icon: Icon,
  title,
  description,
  signal,
}: {
  icon: typeof Activity;
  title: string;
  description: string;
  signal: Signal;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SignalIcon state={signal.state} />
          <span>{signalLabel(signal.state)}</span>
        </div>
      </div>
      <h2 className="mt-5 font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">{signal.detail}</p>
      {signal.checkedAt && (
        <p className="mt-1 text-xs text-muted-foreground">
          Zuletzt geprüft: {new Date(signal.checkedAt).toLocaleTimeString("de-CH")}
        </p>
      )}
    </div>
  );
}

export function StatusPage() {
  const [signals, setSignals] = useState<StatusSignals>(initialSignals);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsRefreshing(true);
    const checkedAt = new Date().toISOString();
    const [apiResult, readinessResult] = await Promise.allSettled([
      fetch("/api/healthz", { cache: "no-store" }),
      fetch("/api/readyz", { cache: "no-store" }),
    ]);

    const apiAvailable =
      apiResult.status === "fulfilled" &&
      apiResult.value.ok &&
      (await apiResult.value.json().catch(() => null)).status === "ok";
    const databaseAvailable =
      readinessResult.status === "fulfilled" &&
      readinessResult.value.ok &&
      (await readinessResult.value.json().catch(() => null)).status === "ok";

    setSignals({
      frontend: {
        state: "operational",
        detail: "Frontend und Statusseite sind erreichbar.",
        checkedAt,
      },
      api: {
        state: apiAvailable ? "operational" : "unavailable",
        detail: apiAvailable
          ? "Der API-Prozess antwortet auf den Liveness-Check."
          : "Der API-Prozess antwortet momentan nicht erfolgreich auf /api/healthz.",
        checkedAt,
      },
      database: {
        state: databaseAvailable ? "operational" : "unavailable",
        detail: databaseAvailable
          ? "Die API erreicht PostgreSQL über den Readiness-Check."
          : "Die Datenbank ist nicht bereit oder der Readiness-Check konnte nicht antworten.",
        checkedAt,
      },
    });
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void checkStatus();
    const interval = window.setInterval(() => void checkStatus(), 30_000);
    return () => window.clearInterval(interval);
  }, [checkStatus]);

  const allOperational = [signals.frontend, signals.api, signals.database].every(
    (signal) => signal.state === "operational",
  );

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Shield className="h-5 w-5" />
            </span>
            <span>
              <span className="block font-bold leading-tight tracking-tight">Bond402</span>
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Trust Infrastructure
              </span>
            </span>
          </Link>
          <Link href="/api-docs" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            API-Doku
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
              <Activity className="h-4 w-4" />
              Öffentlicher Beta-Status
            </div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Bond402-Systemstatus</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Die Statusseite trennt bewusst zwischen erreichbarem Frontend, laufendem API-Prozess
              und Datenbankbereitschaft. So ist klar, welcher Teil der Trust Firewall verfügbar ist.
            </p>
          </div>
          <Button variant="outline" onClick={() => void checkStatus()} disabled={isRefreshing} className="w-full sm:w-auto">
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Jetzt prüfen
          </Button>
        </section>

        <section
          className={`flex items-center gap-3 rounded-2xl border p-4 ${
            allOperational ? "border-emerald-500/25 bg-emerald-500/10" : "border-amber-500/25 bg-amber-500/10"
          }`}
        >
          {allOperational ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
          ) : (
            <TriangleAlert className="h-5 w-5 shrink-0 text-amber-500" />
          )}
          <p className="text-sm font-medium">
            {allOperational
              ? "Alle drei öffentlichen Betriebs-Signale sind aktuell verfügbar."
              : "Mindestens ein Betriebs-Signal ist aktuell eingeschränkt oder wird noch geprüft."}
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <SignalCard
            icon={Activity}
            title="Frontend"
            description="Diese öffentliche Weboberfläche ist erreichbar und kann Statusinformationen anzeigen."
            signal={signals.frontend}
          />
          <SignalCard
            icon={Server}
            title="API-Prozess"
            description="Der Liveness-Check /api/healthz bestätigt, dass der Express-Prozess antwortet."
            signal={signals.api}
          />
          <SignalCard
            icon={Database}
            title="Datenbankbereitschaft"
            description="Der Readiness-Check /api/readyz führt SELECT 1 gegen PostgreSQL aus."
            signal={signals.database}
          />
        </section>

        <section className="grid gap-4 rounded-2xl border border-border/60 bg-card/40 p-5 sm:grid-cols-2 sm:p-6">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <Clock3 className="h-4 w-4 text-primary" />
              Aktualisierung
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Die Signale werden beim Aufruf, alle 30 Sekunden und auf Knopfdruck geprüft.
              Ein eingeschränkter Datenbankstatus bedeutet nicht automatisch, dass das Frontend nicht erreichbar ist.
            </p>
          </div>
          <div>
            <h2 className="font-semibold">Beta-Hinweis</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Bond402 befindet sich in einer öffentlichen Beta. Prüfresultate und externe API-Ziele
              können unabhängig vom Bond402-Systemstatus vorübergehend nicht verfügbar sein.
            </p>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}