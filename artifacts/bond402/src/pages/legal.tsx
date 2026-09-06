import { ArrowLeft, Shield } from "lucide-react";
import { Link } from "wouter";
import { PublicFooter } from "@/components/public-footer";

function LegalPageLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
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

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="mb-10">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary">Bond402</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">{intro}</p>
        </div>
        <article className="space-y-8 text-sm leading-7 text-foreground/85">{children}</article>
      </main>

      <PublicFooter />
    </div>
  );
}

export function ImpressumPage() {
  return (
    <LegalPageLayout
      title="Impressum"
      intro="Angaben zum privaten Betreiber der Bond402 Public Beta und Kontaktmöglichkeit."
    >
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">Betreiber</h2>
        <address className="not-italic">
          <strong>Lucian-Sebastian Morariu-Cabrera-Jimenez</strong>
          <br />
          Oerlikonerstr. 7
          <br />
          8057 Zürich
          <br />
          Schweiz
        </address>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">Kontakt</h2>
        <p>
          E-Mail:{" "}
          <a className="font-medium text-primary hover:underline" href="mailto:support@bond402.com">
            support@bond402.com
          </a>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">Hinweis zum Angebot</h2>
        <p>
          Bond402 wird privat betrieben und befindet sich in einer öffentlichen Beta.
          Neben geschützten Betreiberfunktionen bietet Bond402 ein öffentliches, vom
          Betreiber freigegebenes Verzeichnis maschinenlesbarer API-Trust-Daten.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">Haftung für Inhalte</h2>
        <p>
          Die Inhalte von Bond402 werden mit angemessener Sorgfalt erstellt. Eine
          Gewähr für Vollständigkeit, Aktualität oder jederzeitige Verfügbarkeit kann
          nicht übernommen werden.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">Trust-Signale und Public Beta</h2>
        <p>
          Ein Ergebnis wie <strong>ALLOW</strong> ist ein Entscheidungssignal auf Basis
          gespeicherter Prüf- und Trust-Daten, aber keine Sicherheitsgarantie. Betreiber
          entscheiden selbst, ob ihre Dienste öffentlich gelistet werden. Bei einer
          solchen Listung können die ausgewählten Trust- und Betriebsdaten öffentlich
          sichtbar und maschinenlesbar abrufbar sein.
        </p>
        <p>
          Bond402 befindet sich in einer öffentlichen Beta. Die Angaben beschreiben den
          aktuellen Produktstand und stellen keine individuelle Rechts-, Sicherheits- oder
          Compliance-Beratung dar.
        </p>
      </section>
    </LegalPageLayout>
  );
}

export function DatenschutzPage() {
  return (
    <LegalPageLayout
      title="Datenschutzerklärung"
      intro="Diese Erklärung beschreibt die Datenverarbeitung in der aktuell betriebenen Bond402 Public Beta."
    >
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">1. Verantwortliche Stelle</h2>
        <p>
          Verantwortlich für die Verarbeitung personenbezogener Daten ist:
        </p>
        <address className="not-italic">
          <strong>Lucian-Sebastian Morariu-Cabrera-Jimenez</strong>
          <br />
          Oerlikonerstr. 7
          <br />
          8057 Zürich
          <br />
          Schweiz
          <br />
          E-Mail:{" "}
          <a className="font-medium text-primary hover:underline" href="mailto:support@bond402.com">
            support@bond402.com
          </a>
        </address>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">2. Welche Daten verarbeitet Bond402?</h2>
        <p>
          Je nach Nutzung können insbesondere folgende Daten verarbeitet werden:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Kontodaten wie Name und E-Mail-Adresse für Registrierung, Anmeldung und
            Kontoverwaltung.
          </li>
          <li>
            Das Passwort wird nicht im Klartext gespeichert, sondern als sicherer
            Passwort-Hash verarbeitet.
          </li>
          <li>
            Serverseitige Sitzungsdaten und ein notwendiges Session-Cookie, damit ein
            angemeldetes Konto sicher zugeordnet werden kann.
          </li>
          <li>
            Von Nutzerinnen und Nutzern angelegte API-Schlüssel einschließlich
            technischer Metadaten. Das Geheimnis eines API-Schlüssels wird nicht zur
            späteren vollständigen Anzeige gespeichert.
          </li>
          <li>
            Registrierte Dienstdaten wie Name, URL, erwartete JSON-Struktur,
            Antwortzeitgrenzen sowie gespeicherte Prüfresultate, Trust Scores und
            Prüfverläufe.
          </li>
          <li>
            Wenn ein Betreiber einen Dienst ausdrücklich auf „Gelistet“ stellt, werden
            ausgewählte öffentliche Dienstdaten wie Name, URL, Trust Score, Prüfstatus,
            Prüfzeitpunkt und maschinenlesbare Risikometadaten im öffentlichen Katalog
            veröffentlicht. Kontodaten, Besitzerinformationen, API-Schlüssel und
            interne Prüfdaten werden nicht veröffentlicht.
          </li>
          <li>
            Technische Betriebs- und Sicherheitsdaten, soweit sie für den sicheren
            Betrieb, die Fehlersuche und den Schutz der Anwendung erforderlich sind.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">3. Zweck der Verarbeitung</h2>
        <p>
          Die Verarbeitung erfolgt, um Konten bereitzustellen, Nutzerzugriffe zu
          schützen, API-Schlüssel zu verwalten, registrierte Dienste zu prüfen,
          Prüfresultate innerhalb des Kontos anzuzeigen und ausdrücklich gelistete
          Trust-Metadaten öffentlich für Agenten bereitzustellen.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">4. Eingesetzte Anbieter und externe Ziele</h2>
        <p>
          Für den aktuellen technischen Betrieb werden folgende Anbieter und
          Verbindungen eingesetzt:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Vercel:</strong> Bereitstellung des Frontends und Proxy-Weiterleitung
            der API-Anfragen.
          </li>
          <li>
            <strong>Render:</strong> Betrieb des Bond402-API-Servers.
          </li>
          <li>
            <strong>Neon / PostgreSQL:</strong> Speicherung der Produktionsdatenbank
            für Konten, Sessions, API-Schlüssel, Dienste und Prüfresultate.
          </li>
           <li>
             <strong>Resend:</strong> Versand von E-Mail-Bestätigungen und Passwort-Reset-Links.
             Resend erhält dafür die E-Mail-Adresse, den Anzeigenamen und die jeweilige Nachricht.
           </li>
          <li>
            <strong>Google Fonts:</strong> Einbindung der für die Oberfläche verwendeten
            Schriftarten über Google Fonts.
          </li>
          <li>
            <strong>JSONPlaceholder und GitHub Status:</strong> öffentliche
            Demo-Ziele, die als Beispiel-Dienste für Bond402-Prüfungen angeboten
            werden. Bei einer Prüfung wird eine Anfrage an das jeweilige Ziel
            ausgelöst.
          </li>
        </ul>
        <p>
          Zusätzlich können Nutzer eigene öffentlich erreichbare API-Ziele zur Prüfung
          registrieren. Für die Verarbeitung bei solchen Zielbetreibern gelten deren
          eigene Datenschutzhinweise.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">5. Keine Analyse- oder Zahlungsdienste</h2>
        <p>
           Bond402 verwendet aktuell kein Analytics- oder Werbetracking, kein Sentry
           oder anderes externes Fehlertracking. Der E-Mail-Versand für Authentifizierung
           erfolgt über Resend. Es gibt keine echte Zahlungsabwicklung wie Stripe;
           Wallets, Kryptowährungen und Blockchain-Transaktionen werden nicht eingesetzt.
        </p>
        <p>
          Die x402-Sandbox sowie die Bond-Sandbox sind reine Simulationen. TEST-CREDITS,
          TEST-BONDS, Trust Scores und Reputationswerte haben keinen Geldwert und
          führen zu keiner echten Zahlung, Reservierung oder Blockchain-Buchung.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">6. Cookies und Speicherdauer</h2>
        <p>
          Bond402 verwendet ein technisch notwendiges Session-Cookie für die
          Anmeldung. Es wird nicht für Werbung oder Nutzerprofile eingesetzt.
        </p>
        <p>
          Diese Erklärung nennt keine pauschalen festen Aufbewahrungsfristen. Daten
          werden verarbeitet, solange sie für das Konto, die angeforderten Dienste,
          die Sicherheit oder die Erfüllung gesetzlicher Pflichten erforderlich sind.
          Eine Löschung kann im Einzelfall über die Kontaktadresse angefragt werden;
          gesetzliche Pflichten und technisch notwendige Nachweise bleiben vorbehalten.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">7. Rechte betroffener Personen</h2>
        <p>
          Nach dem schweizerischen Datenschutzrecht können betroffene Personen
          insbesondere Auskunft, Berichtigung und – soweit keine gesetzlichen
          Pflichten entgegenstehen – Löschung oder Vernichtung ihrer Daten verlangen.
          Je nach Voraussetzungen können weitere Rechte, etwa auf Herausgabe oder
          Übertragung von Daten, bestehen.
        </p>
        <p>
          Anfragen können an{" "}
          <a className="font-medium text-primary hover:underline" href="mailto:support@bond402.com">
            support@bond402.com
          </a>{" "}
          gerichtet werden.
        </p>
        <p>
          Sollte die EU-Datenschutz-Grundverordnung (DSGVO) im Einzelfall anwendbar
          sein, können zusätzlich die dort vorgesehenen Rechte gelten. Ob und in
          welchem Umfang das der Fall ist, hängt von den Umständen der jeweiligen
          Verarbeitung ab.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-foreground">8. Änderungen</h2>
        <p>
          Diese Datenschutzerklärung kann angepasst werden, wenn sich die Funktionen,
          die eingesetzten Anbieter oder die rechtlichen Anforderungen ändern.
        </p>
      </section>
    </LegalPageLayout>
  );
}