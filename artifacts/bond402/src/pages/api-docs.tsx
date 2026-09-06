import { ArrowLeft, BookOpen, CheckCircle2, KeyRound, Shield, Timer, LockKeyhole } from "lucide-react";
import { Link } from "wouter";
import { PublicFooter } from "@/components/public-footer";

const readEndpoints = [
  ["GET", "/developer/services/{id}", "Eigenen Dienst, Trust Score und Prüfhistorie abrufen."],
  ["GET", "/developer/services/{id}/checks/latest", "Die letzte gespeicherte Prüfung abrufen."],
  ["GET", "/usage", "Monatliches Paket, Verbrauch, Restkontingent und Reset-Zeit abrufen."],
];

const writeEndpoints = [
  ["POST", "/developer/services/{id}/checks", "Eine Live-Prüfung starten und das Ergebnis speichern."],
];

const agentEndpoints = [
  ["GET", "/public/discovery", "Öffentliche Agent-Discovery und Produktionslinks ohne Schlüssel."],
  ["GET", "/public/services?q=...", "Operator-gelistete Dienste durchsuchen; Pagination bis 50 Einträge."],
  ["GET", "/public/services/{id}/pre-action-check", "Gespeicherte öffentliche ALLOW-, CAUTION- oder BLOCK-Entscheidung lesen."],
  ["POST", "/developer/services/{id}/pre-action-check", "Vor einer externen Agentenaktion ALLOW, CAUTION oder BLOCK abrufen."],
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
            Trust Firewall für AI Agents · OpenAPI 3.1
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Bond402 Developer-API</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Fragen Sie Bond402 vor der Nutzung eines externen Dienstes ab.
             Bond402 bietet öffentliche Service-Discovery, Trust-Metadaten, Live-Checks und
             maschinenlesbare ALLOW-, CAUTION- oder BLOCK-Signale für AI Agents und API-Konsumenten.
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
            <h2 className="font-semibold">Public-Beta-Limits</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
               Öffentlich: 60 pro IP/Minute. Lesen: 60 pro Schlüssel/Minute. Live-Prüfungen: 10 pro Schlüssel/Minute.
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

        <section className="space-y-4 rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold">Für AI Agents: Discovery bis Entscheidung</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Agenten können ohne Konto und ohne API-Key ausschließlich Dienste verwenden, die von ihrem Betreiber öffentlich gelistet wurden.
              Beginnen Sie mit <Code>/.well-known/bond402-agent.json</Code> oder <Code>/api/public/discovery</Code>, suchen Sie anschließend im Katalog
              und lesen Sie die Trust-Daten sowie die gespeicherte Pre-Action-Entscheidung.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-border/60 bg-background/80 p-4 text-xs leading-6 text-muted-foreground">
            <code>{`curl "https://bond402.com/api/public/services?q=wetter&page=1&pageSize=20"
curl -X POST "https://bond402.com/api/public/services/SERVICE_ID/pre-action-check" \\
  -H "Content-Type: application/json" \\
  -d '{"actionContext":"READ"}'`}</code>
          </pre>
          <p className="text-xs leading-5 text-muted-foreground">
            Diese öffentliche Abfrage löst keine Live-Prüfung aus und belastet kein Monatskontingent. Live-Checks,
            Änderungen und ownergebundene Developer-Pre-Action-Checks benötigen weiterhin den passenden Bearer-Key.
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
              Die Public-Beta-Variante verwendet ownergebundene Schlüssel ohne Cross-Account-Delegation,
              Scope-Auswahl oder Ablaufdatum. Rotation erfolgt sicher durch einen neuen Schlüssel und
              das sofortige Widerrufen des alten Schlüssels.
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

        <section className="space-y-5 rounded-2xl border border-primary/25 bg-primary/5 p-5 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold">5-Minuten-Quickstart</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              In fünf Schritten prüfen Sie einen eigenen Dienst und lassen vor einer Agentenaktion
              eine maschinenlesbare Vertrauensentscheidung treffen.
            </p>
          </div>
          <ol className="grid gap-4 text-sm leading-6 text-muted-foreground">
            <li className="rounded-xl border border-border/60 bg-background/70 p-4">
              <strong className="text-foreground">1. Konto und Dienst anlegen.</strong>{" "}
              Registrieren Sie sich, legen Sie im Dashboard einen eigenen HTTPS-Dienst an und kopieren Sie seine Service-ID.
            </li>
            <li className="rounded-xl border border-border/60 bg-background/70 p-4">
              <strong className="text-foreground">2. Developer-Key erstellen.</strong>{" "}
              Öffnen Sie den Developer-Bereich, erstellen Sie einen Schlüssel und speichern Sie das Geheimnis sicher.
            </li>
            <li className="rounded-xl border border-border/60 bg-background/70 p-4">
              <strong className="text-foreground">3. Dienst abrufen.</strong>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-border/50 bg-card/80 p-3 text-xs leading-5">
                <code>{`curl "${browserBase}/developer/services/IHRE_SERVICE_ID" \\
  -H "Authorization: Bearer b402_IHR_SCHLUESSEL"`}</code>
              </pre>
            </li>
            <li className="rounded-xl border border-border/60 bg-background/70 p-4">
              <strong className="text-foreground">4. Live-Check starten.</strong>{" "}
              Bond402 ruft den registrierten Dienst auf, prüft Erreichbarkeit, Antwortzeit und Struktur und speichert das Ergebnis.
              <pre className="mt-3 overflow-x-auto rounded-lg border border-border/50 bg-card/80 p-3 text-xs leading-5">
                <code>{`curl -X POST "${browserBase}/developer/services/IHRE_SERVICE_ID/checks" \\
  -H "Authorization: Bearer b402_IHR_SCHLUESSEL"`}</code>
              </pre>
            </li>
            <li className="rounded-xl border border-border/60 bg-background/70 p-4">
              <strong className="text-foreground">5. Vor der Agentenaktion entscheiden.</strong>{" "}
              Fragen Sie den Pre-Action-Check ab. Er bewertet die gespeicherten aktuellen Daten und liefert ALLOW, CAUTION oder BLOCK.
              <pre className="mt-3 overflow-x-auto rounded-lg border border-border/50 bg-card/80 p-3 text-xs leading-5">
                <code>{`curl -X POST "${browserBase}/developer/services/IHRE_SERVICE_ID/pre-action-check" \\
  -H "Authorization: Bearer b402_IHR_SCHLUESSEL"`}</code>
              </pre>
            </li>
          </ol>
          <p className="text-xs leading-5 text-muted-foreground">
            Alle gezeigten Aufrufe verwenden die Produktionsbasis <Code>{browserBase}</Code>.
            API-Schlüssel gehören ausschließlich in Ihre Secret-Verwaltung und niemals in URLs, Logs oder Browser-Code.
          </p>
        </section>

        <EndpointTable title="Lesen und letzte Ergebnisse" endpoints={readEndpoints} />
        <EndpointTable title="Live-Prüfung" endpoints={writeEndpoints} />
        <EndpointTable title="AI-Agenten vor einer Aktion schützen" endpoints={agentEndpoints} />

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Pre-Action-Entscheidung</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Der Pre-Action-Check bewertet die aktuellste Erreichbarkeit, Antwortzeit,
            Schema-/Strukturtreue, PASS-/FAIL-Historie, Trust Score, Aktualität und
            erkennbare Auffälligkeiten. Die Antwort enthält immer eine Entscheidung,
            verständliche Gründe und die berücksichtigten Faktoren.
          </p>
          <pre className="overflow-x-auto rounded-xl border border-border/60 bg-card/70 p-4 text-xs leading-6 text-muted-foreground">
            <code>{`{
  "decision": "ALLOW",
  "reasons": [
    "Aktuelle Erreichbarkeit, Antwortzeit, Struktur und Historie sprechen für eine Nutzung."
  ],
  "factors": {
    "trustScore": 94,
    "latestReachable": true,
    "latestStructureMatch": true,
    "recentFailures": 0,
    "anomalies": []
  }
}`}</code>
          </pre>
          <p className="text-xs leading-5 text-muted-foreground">
             Der öffentliche Pre-Action-Check liest gespeicherte Daten und ist kostenlos innerhalb des öffentlichen IP-Limits.
             Der ownergebundene Developer-Pre-Action-Check ist ein produktiver Check und wird vom Monatskontingent abgezogen.
             x402-, TEST-CREDITS-, TEST-BONDS- und Reputations-Sandboxes bleiben klar getrennte Simulationen und sind keine Live-Zahlungs- oder Blockchain-Funktionen.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["ALLOW", "Die aktuellen Daten sprechen für die Nutzung. Der Agent kann fortfahren, sollte aber seine eigene fachliche Prüfung behalten."],
              ["CAUTION", "Es gibt Unsicherheiten, zum Beispiel eine schwächere Historie, erhöhte Latenz oder veraltete Prüfdaten. Der Agent sollte vorsichtig fortfahren oder einen Fallback nutzen."],
              ["BLOCK", "Die Daten zeigen ein relevantes Risiko, etwa Nichterreichbarkeit oder wiederholte Fehler. Der Agent sollte die externe Aktion nicht ausführen."],
            ].map(([decision, explanation]) => (
              <div key={decision} className="rounded-xl border border-border/60 bg-card/50 p-4">
                <p className="font-bold text-primary">{decision}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{explanation}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Pilotzugang und Pakete</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Free", "100 Checks", "0 CHF"],
              ["Starter", "2.500 Checks", "19 CHF / Monat"],
              ["Pro", "15.000 Checks", "69 CHF / Monat"],
              ["Business", "75.000 Checks", "199 CHF / Monat"],
              ["Enterprise", "Individuell", "Auf Anfrage"],
            ].map(([name, checks, price]) => (
              <div key={name} className="rounded-xl border border-border/60 bg-card/50 p-4">
                <p className="font-semibold">{name}</p>
                <p className="mt-2 text-sm text-primary">{checks}</p>
                <p className="mt-1 text-xs text-muted-foreground">{price}</p>
              </div>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
             Während der Public Beta werden Kontingente und Pläne manuell aktiviert. Für einen Pilotzugang schreiben Sie an{" "}
             <a className="font-medium text-primary hover:underline" href="mailto:support@bond402.com?subject=Bond402%20Pilotzugang">
               support@bond402.com
             </a>
             . Self-Service-Billing kommt später; aktuell gibt es keinen Checkout und keine automatische Zahlung.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Antworten und Fehler</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Erfolgreiche Antworten sind JSON. Bei Fehlern liefert Bond402 eine neutrale,
            maschinenlesbare Antwort mit <Code>error</Code> und <Code>code</Code>.
            Häufige Codes sind <Code>INVALID_API_KEY</Code>, <Code>NOT_FOUND</Code>,
            <Code>RATE_LIMITED</Code>, <Code>QUOTA_EXCEEDED</Code> und <Code>INTERNAL_ERROR</Code>. Bei <Code>429</Code>
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
            {["/auth/register", "/auth/login", "/auth/logout", "/auth/verify-email", "/auth/resend-verification", "/auth/password/forgot", "/auth/password/reset", "/auth/password", "/services", "/dashboard", "/api-keys"].map((path) => (
              <Code key={path}>{path}</Code>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-primary/25 bg-primary/5 p-5 text-sm leading-6">
          <strong className="text-primary">Sicherer E-Mail-Auth-Flow:</strong>{" "}
          Neue Konten bestätigen ihre E-Mail-Adresse über einen 24 Stunden gültigen Einmal-Link.
          Passwort-Reset-Links sind 30 Minuten gültig, werden serverseitig nur als Hash gespeichert
          und nach der ersten Nutzung verbraucht. Resend erhält ausschließlich den serverseitigen
          Versandauftrag; API-Schlüssel und Token werden nie im Frontend oder in Logs ausgegeben.
        </section>

        <section className="space-y-3 rounded-2xl border border-border/60 bg-card/40 p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Server-Konfiguration für Auth-E-Mails</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Der API-Server benötigt <Code>RESEND_API_KEY</Code> als Secret,
            <Code>PUBLIC_BASE_URL</Code> als öffentliche HTTPS-Basis für Links und optional
            <Code>RESEND_FROM_EMAIL</Code>. Bis zur Domain-Verifizierung ist
            <Code>onboarding@resend.dev</Code> der kompatible Standard-Absender.
            Der Resend-Key wird niemals an Browser oder API-Clients ausgeliefert.
          </p>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}