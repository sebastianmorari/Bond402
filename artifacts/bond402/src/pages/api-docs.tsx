import { ArrowLeft, BookOpen, CheckCircle2, KeyRound, Shield, Timer, LockKeyhole } from "lucide-react";
import { Link } from "wouter";
import { PublicFooter } from "@/components/public-footer";

const readEndpoints = [
  ["GET", "/developer/services/{id}", "Eigenen Dienst, Trust Score und Prüfhistorie abrufen."],
  ["GET", "/developer/services/{id}/checks/latest", "Die letzte gespeicherte Prüfung abrufen."],
];

const writeEndpoints = [
  ["POST", "/developer/services/{id}/checks", "Eine Live-Prüfung starten und das Ergebnis speichern."],
];

function Code({ children }: { children: string }) {
  return (
    <code className="break-all rounded-md border border-border/60 bg-background/80 px-2 py-1 font-mono text-xs text-primary">
      {children}
    </code>
  );
}

function EndpointTable({
  title,
  endpoints,
}: {
  title: string;
  endpoints: string[][];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-border/60">
        <div className="hidden grid-cols-[5rem_minmax(0,1fr)_minmax(0,1.5fr)] gap-4 bg-muted/30 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
          <span>Methode</span>
          <span>Endpunkt</span>
          <span>Wirkung</span>
        </div>
        {endpoints.map(([method, path, description]) => (
          <div
            key={`${method}-${path}`}
            className="grid gap-2 border-t border-border/60 px-4 py-3 first:border-t-0 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1.5fr)] sm:items-center sm:gap-4"
          >
            <span className="text-xs font-bold text-primary">{method}</span>
            <Code>{path}</Code>
            <span className="text-sm text-muted-foreground">{description}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ApiDocsPage() {
  const browserBase = `${window.location.origin}/api`;

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
          <Link href="/" className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Zur Startseite
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <section className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
            <BookOpen className="h-4 w-4" />
            Öffentliche REST-API · OpenAPI 3.1
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Bond402 Developer-API</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Automatisieren Sie Prüfungen Ihrer eigenen, öffentlich erreichbaren API-Dienste.
            Die API speichert nur Dienste und Prüfresultate Ihres eigenen Kontos und führt
            keine Zahlungen oder Blockchain-Transaktionen aus.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-card/60 p-5">
            <LockKeyhole className="mb-3 h-5 w-5 text-primary" />
            <h2 className="font-semibold">Sichere Authentifizierung</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Für Developer-Aufrufe wird ein API-Schlüssel als Bearer-Token verwendet.
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 p-5">
            <CheckCircle2 className="mb-3 h-5 w-5 text-success" />
            <h2 className="font-semibold">Nur eigene Dienste</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Jeder Schlüssel ist an das Konto gebunden, das den Dienst registriert hat.
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 p-5">
            <Timer className="mb-3 h-5 w-5 text-primary" />
            <h2 className="font-semibold">MVP-Limits</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Lesen: 60 pro Schlüssel/Minute. Live-Prüfungen: 10 pro Schlüssel/Minute.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="h-5 w-5 text-primary" />
            Produktionsbasis
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Verwenden Sie für öffentliche Aufrufe die Basis der Bond402-Webanwendung.
            Der Vercel-Proxy leitet <Code>/api</Code> sicher an den Render-API-Server weiter.
          </p>
          <div className="mt-4 rounded-xl border border-border/60 bg-background/80 p-4 font-mono text-sm break-all">
            {browserBase}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Die angezeigte Basis wird automatisch aus der aktuellen öffentlichen Bond402-Adresse
            berechnet. Keine lokale Entwicklungsadresse in produktiven Integrationen verwenden.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Authentifizierung und API-Schlüssel</h2>
          <div className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>
              1. Erstellen Sie im eingeloggten Bereich unter <strong className="text-foreground">Developer</strong> einen Schlüssel.
              Das vollständige Geheimnis wird nur einmal angezeigt und anschließend nicht mehr gespeichert.
            </p>
            <p>
              2. Übergeben Sie ihn ausschließlich über den HTTPS-Header
              {" "}<Code>Authorization: Bearer b402_…</Code>.
            </p>
            <p>
              3. Speichern Sie ihn in Ihrer CI/CD-Geheimnisverwaltung. Nicht in URLs,
              Quellcode, Browser-Local-Storage, Logs oder Fehlermeldungen ablegen.
            </p>
            <p>
              4. Widerrufen Sie einen Schlüssel im Developer-Bereich sofort, wenn er nicht
              mehr benötigt wird. Ein Widerruf wirkt unmittelbar und kann nicht rückgängig gemacht werden.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-border/60 bg-card/70 p-4 text-xs leading-6 text-muted-foreground">
            <code>{`curl "${browserBase}/developer/services/IHRE_SERVICE_ID" \\
  -H "Authorization: Bearer b402_IHR_SCHLUESSEL"`}</code>
          </pre>
        </section>

        <EndpointTable title="Lesen und letzte Ergebnisse" endpoints={readEndpoints} />
        <EndpointTable title="Live-Prüfung" endpoints={writeEndpoints} />

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Antworten und Fehler</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Erfolgreiche Antworten sind JSON. Bei Fehlern liefert Bond402 eine neutrale,
            maschinenlesbare Antwort mit <Code>error</Code> und <Code>code</Code>.
            Häufige Codes sind <Code>INVALID_API_KEY</Code>, <Code>NOT_FOUND</Code>,
            <Code>RATE_LIMITED</Code> und <Code>INTERNAL_ERROR</Code>. Bei <Code>429</Code>
            beachten Sie den Header <Code>Retry-After</Code>.
          </p>
          <pre className="overflow-x-auto rounded-xl border border-border/60 bg-card/70 p-4 text-xs leading-6 text-muted-foreground">
            <code>{`{
  "error": "API-Schlüssel fehlt oder ist ungültig.",
  "code": "INVALID_API_KEY"
}`}</code>
          </pre>
        </section>

        <section className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Weitere Endpunkte im OpenAPI-Vertrag</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Konto-, Dienst-, Dashboard- und Schlüsselverwaltung sind ebenfalls in der
            vorhandenen OpenAPI-Spezifikation beschrieben. Diese Endpunkte verwenden das
            sichere HttpOnly-Session-Cookie der Webanwendung und sind nicht für Bearer-Schlüssel gedacht.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {["/auth/register", "/auth/login", "/auth/logout", "/auth/password", "/services", "/dashboard", "/api-keys"].map((path) => (
              <Code key={path}>{path}</Code>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-warning/30 bg-warning/10 p-5 text-sm leading-6">
          <strong className="text-warning">Bewusst nicht aktiviert:</strong>{" "}
          Passwort-Wiederherstellung und E-Mail-Verifizierung sind im MVP nicht live.
          Dafür ist ein E-Mail-Anbieter mit sicherem Secret und verifizierten Zustellwegen nötig.
          Es gibt deshalb keine unsicheren Reset-Links oder Fake-Bestätigungen.
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}