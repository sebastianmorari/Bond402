import { useMemo, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  CircleDollarSign,
  History,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { CheckResult } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BondServiceOption = {
  id: string;
  name: string;
  trustScore: number | null;
  checks?: CheckResult[];
};

interface BondSandboxProps {
  services: BondServiceOption[];
}

export function BondSandbox({ services }: BondSandboxProps) {
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [bondAmount, setBondAmount] = useState("10");
  const [hasRun, setHasRun] = useState(false);

  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId) || services[0],
    [selectedServiceId, services],
  );

  const latestCheck = selectedService?.checks?.[0];
  const trustScore = selectedService?.trustScore ?? null;
  const amount = Number.parseFloat(bondAmount.replace(",", "."));
  const isValidAmount = Number.isFinite(amount) && amount > 0 && amount <= 1000;
  const securityChecks = selectedService
    ? [
        { label: "Dienst gehört dem angemeldeten Konto", passed: true },
        { label: "API-Zugriff bleibt getrennt und widerrufbar", passed: true },
        { label: "Trust Score erfüllt den Test-Schwellenwert", passed: trustScore !== null && trustScore >= 70 },
        { label: "Letzte echte Prüfung war erfolgreich", passed: latestCheck?.status === "PASS" },
      ]
    : [];
  const approved = securityChecks.length > 0 && securityChecks.every((check) => check.passed);
  const reputationDelta = approved ? 3 : -2;

  const runSimulation = () => {
    if (selectedService && isValidAmount) {
      setHasRun(true);
      window.localStorage.setItem("bond402:onboarding:bond", "done");
    }
  };

  return (
    <Card id="bond-sandbox" className="scroll-mt-24 border-violet-400/30 bg-gradient-to-br from-violet-500/5 via-card to-card shadow-lg shadow-violet-500/5">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-violet-400" />
              Bond-, Sicherheits- und Reputations-Sandbox
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl">
              Simuliert, wie ein Sicherheits-Bond später anhand echter Prüfwerte bewertet werden könnte.
            </CardDescription>
          </div>
          <Badge variant="warning" className="gap-1">
            <Sparkles className="h-3 w-3" /> Keine echten Werte
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border border-violet-400/25 bg-violet-500/10 p-4 text-sm leading-relaxed text-foreground/85">
          <strong className="text-violet-300">Nur Simulation:</strong> TEST-BONDS und Reputationspunkte existieren ausschließlich für diese Demo. Es wird nichts bezahlt, reserviert, auf einer Blockchain verbucht oder in der Datenbank verändert.
        </div>

        {services.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-6 text-center text-sm text-muted-foreground">
            Registrieren Sie zuerst einen eigenen Dienst, um die Sicherheitslogik daran zu simulieren.
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bond-sandbox-service">Eigener Dienst</Label>
                <select
                  id="bond-sandbox-service"
                  value={selectedService?.id || ""}
                  onChange={(event) => {
                    setSelectedServiceId(event.target.value);
                    setHasRun(false);
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bond-sandbox-amount">Simulierter Bond</Label>
                <div className="relative">
                  <Input
                    id="bond-sandbox-amount"
                    inputMode="decimal"
                    value={bondAmount}
                    onChange={(event) => {
                      setBondAmount(event.target.value);
                      setHasRun(false);
                    }}
                    className="pr-28"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                    TEST-BONDS
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Testbereich: 0,01 bis 1.000 TEST-BONDS</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: CircleDollarSign, title: "Bond bereitstellen", text: `${isValidAmount ? bondAmount : "—"} TEST-BONDS` },
                { icon: LockKeyhole, title: "Sicherheit prüfen", text: "Besitz & Zugriff" },
                { icon: ShieldCheck, title: "Dienst bewerten", text: trustScore === null ? "Noch kein Score" : `${trustScore}% Trust Score` },
                { icon: History, title: "Reputation ändern", text: "Nur simuliert" },
              ].map((step) => (
                <div key={step.title} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                  <step.icon className="mb-2 h-4 w-4 text-violet-300" />
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{step.text}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={runSimulation} disabled={!selectedService || !isValidAmount} className="gap-2">
                <Sparkles className="h-4 w-4" />
                Simulation ausführen
              </Button>
              {hasRun && (
                <Button variant="outline" onClick={() => setHasRun(false)}>
                  Zurücksetzen
                </Button>
              )}
            </div>

            {!isValidAmount && (
              <p className="text-sm text-destructive">Bitte geben Sie einen Testwert zwischen 0,01 und 1.000 ein.</p>
            )}

            {hasRun && selectedService && (
              <div className={`space-y-4 rounded-xl border p-4 ${approved ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-semibold">
                      {approved ? <CheckCircle2 className="h-5 w-5 text-success" /> : <TriangleAlert className="h-5 w-5 text-warning" />}
                      {approved ? "Simulation würde freigegeben" : "Simulation würde zur Prüfung zurückgestellt"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {approved
                        ? "Alle Test-Sicherheitsregeln sind erfüllt. Der Bond würde nach erfolgreicher Leistung zurückgegeben."
                        : "Mindestens eine Test-Sicherheitsregel ist noch nicht erfüllt. Ein späteres System würde keinen automatischen Vertrauensvorschuss geben."}
                    </p>
                  </div>
                  <Badge variant={approved ? "success" : "warning"}>{approved ? "APPROVED (SIMULIERT)" : "REVIEW (SIMULIERT)"}</Badge>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {securityChecks.map((check) => (
                    <div key={check.label} className="flex items-center gap-2 text-sm">
                      {check.passed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <XCircle className="h-4 w-4 shrink-0 text-warning" />}
                      <span>{check.label}</span>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Test-Bond</p>
                    <p className="mt-1 font-mono text-sm">{bondAmount} TEST-BONDS</p>
                  </div>
                  <div className="rounded-lg bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Simulierte Reputation</p>
                    <p className={`mt-1 font-semibold ${reputationDelta > 0 ? "text-success" : "text-warning"}`}>
                      {reputationDelta > 0 ? "+" : ""}{reputationDelta} Punkte
                    </p>
                  </div>
                  <div className="rounded-lg bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Test-Abschluss</p>
                    <p className="mt-1 flex items-center gap-1 font-semibold"><BadgeCheck className="h-4 w-4 text-violet-300" /> Keine Buchung</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}