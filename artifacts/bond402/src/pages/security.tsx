import { ArrowLeft, CheckCircle2, Shield, XCircle } from "lucide-react";
import { Link } from "wouter";
import { PublicFooter } from "@/components/public-footer";

function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-card/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Shield className="h-5 w-5" /></span>
            <span><span className="block font-bold leading-tight">Bond402</span><span className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Security & Trust</span></span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Zur Startseite</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">{children}</main>
      <PublicFooter />
    </div>
  );
}

export function SecurityPage() {
  return (
    <PageLayout>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Bond402 Security & Trust</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Beobachtbare Signale für APIs und AI Agents</h1>
      <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">
        Bond402 prüft registrierte, öffentlich erreichbare Dienste und stellt die gespeicherten Ergebnisse als maschinenlesbare Hinweise bereit.
        Das hilft Agenten, vor einer Aktion zwischen ALLOW, CAUTION und BLOCK zu unterscheiden.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-border/60 bg-card/50 p-6">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <h2 className="mt-3 text-xl font-semibold">Was Bond402 prüft</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>öffentliche Erreichbarkeit, HTTP-Status und Antwortzeit</li>
            <li>gültiges JSON und erwartete Feldstruktur</li>
            <li>HTTPS und beobachtbare TLS-Zertifikatsdaten</li>
            <li>ausgewählte Security-Header, mit fehlenden Headern als sichtbare Auffälligkeit</li>
            <li>beobachtete Uptime sowie p95/p99-Latenz aus gespeicherten Livechecks</li>
            <li>optionale Domain-Verifizierung über eine HTTPS-Well-Known-Datei</li>
          </ul>
        </section>
        <section className="rounded-2xl border border-border/60 bg-card/50 p-6">
          <XCircle className="h-5 w-5 text-destructive" />
          <h2 className="mt-3 text-xl font-semibold">Was Bond402 nicht behauptet</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>ALLOW ist keine Sicherheitsgarantie und keine fachliche Freigabe.</li>
            <li>Bond402 ersetzt keine Sicherheitsprüfung, kein Penetration Testing und kein Audit.</li>
            <li>Es gibt keine Malware- oder Schwachstellenanalyse durch diese Signale.</li>
            <li>Ein Trust Score ist weder Zertifizierung noch externe Reputation.</li>
            <li>Die Werte beschreiben nur die gespeicherten Bond402-Beobachtungen im sichtbaren Zeitraum.</li>
          </ul>
        </section>
      </div>

      <section className="mt-8 rounded-2xl border border-primary/25 bg-primary/5 p-6">
        <h2 className="text-xl font-semibold">Signalzustände</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          {[
            ["Geprüft", "CHECKED", "Signal wurde bei einer Liveprüfung beobachtet."],
            ["Auffällig", "WARNING", "Signal weicht ab oder benötigt Aufmerksamkeit."],
            ["Nicht verfügbar", "UNAVAILABLE", "Signal konnte nicht vollständig ausgewertet werden."],
            ["Nicht bewertet", "NOT_EVALUATED", "Es liegen noch keine passenden Daten vor."],
          ].map(([title, code, description]) => <div key={code} className="rounded-xl border border-border/60 bg-background/60 p-3"><p className="font-semibold">{title} <span className="font-mono text-xs text-muted-foreground">{code}</span></p><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>)}
        </div>
      </section>

      <section className="mt-8 space-y-4 text-sm leading-7 text-foreground/85">
        <h2 className="text-xl font-semibold text-foreground">Betreiber und Kontakt</h2>
        <p><strong>Sebastian Morariu, Founder, Bond402</strong><br /><a className="text-primary hover:underline" href="mailto:support@bond402.com">support@bond402.com</a></p>
        <p>Rechtliche Angaben finden Sie im <Link className="text-primary hover:underline" href="/impressum">Impressum</Link>. Informationen zur Verarbeitung personenbezogener Daten stehen in der <Link className="text-primary hover:underline" href="/datenschutz">Datenschutzerklärung</Link>. Für eine kurze Produktbeschreibung gibt es die <Link className="text-primary hover:underline" href="/about">About-Seite</Link>.</p>
      </section>
    </PageLayout>
  );
}

export function AboutPage() {
  return (
    <PageLayout>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Über Bond402</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Eine Vertrauensschicht vor API-Aktionen</h1>
      <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">Bond402 richtet sich an Teams und AI Agents, die vor der Nutzung eines externen API- oder Tool-Dienstes nachvollziehbare, maschinenlesbare Hinweise brauchen.</p>
      <div className="mt-10 space-y-6 text-sm leading-7 text-foreground/85">
        <section><h2 className="text-xl font-semibold text-foreground">Das Produkt</h2><p className="mt-2">Betreiber registrieren Dienste, definieren die erwartete JSON-Struktur und können Livechecks auslösen. Bond402 speichert beobachtbare Signale, berechnet einen erklärten Trust Score und stellt vor einer Aktion ALLOW, CAUTION oder BLOCK bereit.</p></section>
        <section><h2 className="text-xl font-semibold text-foreground">Der öffentliche Katalog</h2><p className="mt-2">Nur ausdrücklich gelistete Dienste sind öffentlich auffindbar. Öffentliche Pre-Action-Abfragen lesen gespeicherte Ergebnisse; sie starten keinen neuen Livecheck und geben keine Account- oder Ownerdaten aus.</p></section>
        <section><h2 className="text-xl font-semibold text-foreground">Grenzen</h2><p className="mt-2">Bond402 ist keine universelle Suche, kein Audit und keine Sicherheitsgarantie. Die <Link className="text-primary hover:underline" href="/security">Security-&-Trust-Seite</Link> beschreibt die geprüften Signale und Grenzen präzise.</p></section>
      </div>
    </PageLayout>
  );
}