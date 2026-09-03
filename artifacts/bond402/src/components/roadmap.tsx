import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Lock, Coins, ShieldCheck, Activity } from 'lucide-react';

export function Roadmap() {
  return (
    <section className="space-y-6 mt-20 pb-16 border-t border-border/50 pt-16">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Bond402 Ausblick</h2>
        <p className="text-muted-foreground max-w-2xl">
          Diese Funktionen befinden sich in der Entwicklung und etablieren einen neuen Standard für maschinengesteuerte API-Sicherheit.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 opacity-80">
        <Card className="bg-muted/10 border-dashed border-border/50 hover:bg-muted/20 transition-colors">
          <CardHeader>
            <Coins className="w-6 h-6 text-primary mb-2" />
            <CardTitle className="text-lg">x402 Protokoll</CardTitle>
            <CardDescription className="text-primary/70 font-mono text-xs uppercase tracking-wider">In Entwicklung</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground leading-relaxed">
            Automatisierte, maschinenlesbare Mikro-Zahlungen für API-Aufrufe. Keine manuellen Abrechnungen mehr nötig.
          </CardContent>
        </Card>

        <Card className="bg-muted/10 border-dashed border-border/50 hover:bg-muted/20 transition-colors">
          <CardHeader>
            <Lock className="w-6 h-6 text-primary mb-2" />
            <CardTitle className="text-lg">Smart Bonds</CardTitle>
            <CardDescription className="text-primary/70 font-mono text-xs uppercase tracking-wider">In Entwicklung</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground leading-relaxed">
            Diensteanbieter hinterlegen eine Kaution (Bond). Fällt der Dienst aus, werden Nutzer über Smart Contracts entschädigt.
          </CardContent>
        </Card>

        <Card className="bg-muted/10 border-dashed border-border/50 hover:bg-muted/20 transition-colors">
          <CardHeader>
            <ShieldCheck className="w-6 h-6 text-primary mb-2" />
            <CardTitle className="text-lg">Reputationssystem</CardTitle>
            <CardDescription className="text-primary/70 font-mono text-xs uppercase tracking-wider">Geplant</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground leading-relaxed">
            Kryptografisch nachweisbare, fälschungssichere Historie der Zuverlässigkeit, dezentral gespeichert.
          </CardContent>
        </Card>

        <Card className="bg-muted/10 border-dashed border-border/50 hover:bg-muted/20 transition-colors">
          <CardHeader>
            <Activity className="w-6 h-6 text-primary mb-2" />
            <CardTitle className="text-lg">Netzwerk-Infrastruktur</CardTitle>
            <CardDescription className="text-primary/70 font-mono text-xs uppercase tracking-wider">Geplant</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground leading-relaxed">
            Eine eigene dezentrale Architektur zur Koordination und Absicherung des gesamten Verifizierungsnetzwerks.
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
