import { DemoServices } from "@/components/demo-services";
import { PublicFooter } from "@/components/public-footer";
import { Shield, ArrowRight, Activity, CheckCircle2, ShieldCheck, Search, Mail, Radio } from "lucide-react";
import { Link } from "wouter";

export function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      <header className="border-b border-border/40 bg-card/30 sticky top-0 z-20 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">Bond402</h1>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold leading-none">Trust Infrastructure</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/api-docs" className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline">
              API-Doku
            </Link>
            <Link href="/catalog" className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline">
              Katalog
            </Link>
            <Link href="/sign-in" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Anmelden
            </Link>
            <Link href="/sign-up" className="text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md shadow-lg shadow-primary/20 transition-all flex items-center gap-2">
              Kostenlos registrieren <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Background decorative elements */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] mix-blend-screen" />
        </div>

        <div className="max-w-4xl w-full text-center space-y-8 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-4">
            <Activity className="h-4 w-4" />
            <span>Public Beta · Trust Layer for AI Agents</span>
          </div>
          
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground">
            Agenten und APIs brauchen<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-cyan-400">
              verlässliche Signale vor der Aktion.
            </span>
          </h1>
          
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Bond402 verbindet einen öffentlichen Service-Katalog, gespeicherte Trust-Metadaten
            und Live-Checks zu einer maschinenlesbaren Entscheidung vor der Nutzung eines externen Dienstes:
            <strong className="text-foreground"> ALLOW</strong>,
            <strong className="text-foreground"> CAUTION</strong> oder
            <strong className="text-foreground"> BLOCK</strong>.
            Betreiber entscheiden selbst, welche Dienste öffentlich gelistet werden.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link href="/sign-up" className="w-full sm:w-auto text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-3.5 rounded-lg shadow-xl shadow-primary/25 transition-all flex items-center justify-center gap-2">
              Public Beta starten
            </Link>
            <Link href="/sign-in" className="w-full sm:w-auto text-base font-medium bg-card border border-border hover:bg-card/80 text-foreground px-8 py-3.5 rounded-lg transition-all flex items-center justify-center">
              Zum Dashboard
            </Link>
          </div>
          <p className="mx-auto max-w-2xl text-xs leading-5 text-muted-foreground">
            ALLOW ist ein Entscheidungssignal auf Basis gespeicherter Trust-Daten und keine
            Sicherheitsgarantie. Prüfen Sie weiterhin Ihre eigene fachliche und rechtliche Risikolage.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-16 max-w-3xl mx-auto text-left">
            <div className="bg-card/50 border border-border/50 p-5 rounded-xl space-y-3">
              <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">Dienste entdecken</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">AI Agents und API-Nutzer finden Betreiber, die ihre Trust-Daten ausdrücklich öffentlich gelistet haben.</p>
            </div>
            <div className="bg-card/50 border border-border/50 p-5 rounded-xl space-y-3">
              <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                <Activity className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">Vor der Aktion entscheiden</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Pre-Action-Checks liefern ALLOW, CAUTION oder BLOCK mit Gründen, Freshness und Policy-Metadaten.</p>
            </div>
            <div className="bg-card/50 border border-border/50 p-5 rounded-xl space-y-3">
              <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">Live-Checks und Historie</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Erreichbarkeit, Antwortzeit, Struktur, Historie und Trust Score werden nachvollziehbar zusammengeführt.</p>
            </div>
          </div>
        </div>
      </main>

      <section className="border-t border-border/40 bg-muted/20 py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
             <h2 className="text-2xl font-bold tracking-tight mb-2">Von der Entdeckung zur Entscheidung</h2>
             <p className="text-muted-foreground">Suchen Sie im öffentlichen Katalog oder registrieren Sie einen eigenen Dienst für Live-Checks und Agentenentscheidungen.</p>
          </div>
          
          <div className="bg-card/50 border border-border/50 rounded-2xl p-6 sm:p-8">
            <DemoServices readOnly={true} />
          </div>
        </div>
      </section>

      <section className="border-t border-border/40 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10 text-center">
             <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary">Public Beta · Early Access</p>
             <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Pilotzugang für Teams und API-Betreiber</h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
               Wir onboarden erste Pilotkunden manuell. Besprechen Sie Ihren Dienst, Ihre Agenten-Workflows
               und das passende Kontingent direkt mit uns.
            </p>
          </div>
           <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
               ["Pilot", "manuell aktiviert", "für frühe Teams"],
               ["Starter", "2.500 Checks", "später self-service"],
               ["Pro", "15.000 Checks", "später self-service"],
               ["Enterprise", "individuell", "gemeinsam definieren"],
             ].map(([name, checks, price]) => (
              <div key={name} className="rounded-xl border border-border/60 bg-card/50 p-4 text-center">
                <p className="font-semibold">{name}</p>
                <p className="mt-2 text-sm font-medium text-primary">{checks}</p>
                <p className="mt-1 text-xs text-muted-foreground">{price}</p>
              </div>
            ))}
          </div>
           <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
             <a href="mailto:support@bond402.com?subject=Bond402%20Pilotzugang" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90">
               <Mail className="h-4 w-4" />
               Pilotzugang anfragen
             </a>
             <Link href="/catalog" className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-5 py-3 text-sm font-medium transition-colors hover:bg-card/80">
               <Search className="h-4 w-4" />
               Öffentlichen Katalog öffnen
             </Link>
           </div>
           <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
             Während der Public Beta werden Pläne und Kontingente manuell aktiviert. Self-Service-Billing
             kommt später; aktuell gibt es keinen Checkout und keine automatische Zahlung.
          </p>
        </div>
      </section>

       <section className="border-t border-border/40 bg-muted/20 px-4 py-16 sm:px-6 lg:px-8">
         <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-[1.2fr_0.8fr] md:items-center">
           <div>
             <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-primary">
               <Radio className="h-4 w-4" />
               Klarer Beta-Rahmen
             </div>
             <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Wie lange bleibt Bond402 in Beta?</h2>
             <p className="mt-3 leading-7 text-muted-foreground">
               Es gibt bewusst kein künstliches Enddatum. Die Public Beta bleibt aktiv, bis wir
               Katalog, Trust-Signale, Live-Checks und Agenten-API mit Pilotkunden belastbar validiert
               haben und Self-Service-Billing bereit ist. Den Übergang kündigen wir vorab an.
             </p>
           </div>
           <div className="rounded-2xl border border-border/60 bg-card/60 p-5 text-sm leading-6 text-muted-foreground">
             <p className="font-semibold text-foreground">Was heute live ist</p>
             <ul className="mt-3 space-y-2">
               <li>✓ Öffentliche Discovery und gelistete Services</li>
               <li>✓ Trust-Metadaten und gespeicherte Prüfungen</li>
               <li>✓ ALLOW · CAUTION · BLOCK vor Agentenaktionen</li>
               <li>✓ Owner-geschützte Live-Checks und API-Keys</li>
             </ul>
           </div>
         </div>
       </section>

      <PublicFooter />
    </div>
  );
}
