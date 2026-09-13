import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  History,
  Info,
  KeyRound,
  LockKeyhole,
  Play,
  ServerCog,
  WalletCards,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  CheckResult,
  DeveloperServiceResult,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

type ServiceOption = {
  id: string;
  name: string;
  url: string;
  expectedStructure: string;
  maxResponseTime: number;
  trustScore: number | null;
  trustExplanation: string;
  checks?: CheckResult[];
};

type SandboxResult = {
  service: ServiceOption;
  trustScore: number | null;
  trustExplanation: string;
  latestCheck: CheckResult | null;
  checks: CheckResult[];
  simulated: boolean;
};

const steps = [
  {
    label: "Anfrage",
    description: "Ein Client fragt den geschützten Dienst an.",
    icon: ArrowRight,
  },
  {
    label: "Zahlungsanforderung",
    description: "Der Dienst antwortet im x402-Muster mit einer Testanforderung.",
    icon: WalletCards,
  },
  {
    label: "Simulierte Freigabe",
    description: "Ein Testkonto gibt 0,01 TEST-CREDITS frei.",
    icon: LockKeyhole,
  },
  {
    label: "Dienstprüfung",
    description: "Bond402 prüft den registrierten Dienst.",
    icon: ServerCog,
  },
  {
    label: "Ergebnis",
    description: "Trust Score und gespeicherte Prüfungen werden sichtbar.",
    icon: Zap,
  },
] as const;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function simulatedCheck(serviceId: string): CheckResult {
  return {
    id: `sandbox-${Date.now()}`,
    serviceId,
    checkedAt: new Date().toISOString(),
    status: "PASS",
    checkType: "LIVE",
    reachable: true,
    responseTimeMs: 142,
    structureMatch: true,
    httpStatus: 200,
    errorCode: null,
    summary: "Sandbox-Ergebnis: Dienstprüfung erfolgreich simuliert.",
    foundFields: ["status", "data"],
    missingFields: [],
    https: true,
    tlsStatus: "CHECKED",
    tlsExpiresAt: null,
    tlsDaysRemaining: null,
    securityHeaders: {
      status: "CHECKED",
      evaluated: [],
      present: [],
      missing: [],
    },
    securitySignals: {
      reachability: { status: "PASS", summary: "Sandbox-Erreichbarkeit simuliert." },
      transport: {
        status: "PASS",
        summary: "Sandbox-HTTPS/TLS simuliert.",
        https: true,
        protocol: "TLSv1.3",
        certificateValid: true,
        expiresAt: null,
        daysRemaining: null,
      },
      network: { status: "PASS", summary: "Sandbox-Netzwerkprüfung simuliert." },
      redirects: {
        status: "PASS",
        summary: "Keine Weiterleitung simuliert.",
        count: 0,
        crossOrigin: false,
        downgraded: false,
      },
      responseType: {
        status: "PASS",
        summary: "JSON-Antwort simuliert.",
        kind: "JSON",
        contentType: "application/json",
      },
      suspiciousPayload: {
        status: "PASS",
        summary: "Keine auffälligen Muster simuliert.",
        indicators: [],
      },
      securityHeaders: {
        status: "UNKNOWN",
        summary: "Header-Signale werden in der Sandbox nicht simuliert.",
        evaluated: [],
        present: [],
        missing: [],
      },
      reputation: {
        status: "UNKNOWN",
        summary: "Keine Reputation simuliert.",
      },
      rateLimit: {
        status: "UNKNOWN",
        summary: "Kein Rate-Limit-Signal simuliert.",
        detected: false,
        retryAfterSeconds: null,
      },
      authentication: {
        status: "UNKNOWN",
        summary: "Keine Authentifizierung simuliert.",
        required: false,
      },
      securityConfidence: {
        status: "WARNING",
        score: 60,
        summary: "Sandbox-Sicherheitswerte sind simuliert.",
      },
      threatIndicators: {
        status: "UNKNOWN",
        severity: "LOW",
        confidence: 0,
        indicators: [],
        summary: "Threat-Indikatoren werden in der Sandbox nicht simuliert.",
      },
      historicalDrift: {
        status: "UNKNOWN",
        indicators: [],
        summary: "Historische Abweichungen werden in der Sandbox nicht simuliert.",
      },
    },
    probeRegion: "sandbox",
  };
}

async function readApiError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || `Die Developer-API antwortete mit HTTP ${response.status}.`;
  } catch {
    return `Die Developer-API antwortete mit HTTP ${response.status}.`;
  }
}

interface X402SandboxProps {
  services: ServiceOption[];
}

export function X402Sandbox({ services }: X402SandboxProps) {
  const { toast } = useToast();
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [currentStep, setCurrentStep] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SandboxResult | null>(null);

  useEffect(() => {
    if (!selectedServiceId && services[0]) setSelectedServiceId(services[0].id);
    if (selectedServiceId && !services.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId(services[0]?.id || "");
    }
  }, [selectedServiceId, services]);

  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId),
    [selectedServiceId, services],
  );

  const runSandbox = async () => {
    if (!selectedService || isRunning) return;
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      setCurrentStep(0);
      await wait(400);
      setCurrentStep(1);
      await wait(550);
      setCurrentStep(2);
      await wait(550);
      setCurrentStep(3);
      await wait(450);

      let sandboxResult: SandboxResult;
      if (apiKey.trim()) {
        const response = await fetch(
          `/api/developer/services/${encodeURIComponent(selectedService.id)}/checks`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey.trim()}` },
          },
        );
        if (!response.ok) throw new Error(await readApiError(response));
        const data = (await response.json()) as DeveloperServiceResult;
        sandboxResult = {
          service: selectedService,
          trustScore: data.trustScore,
          trustExplanation: data.trustExplanation,
          latestCheck: data.latestCheck,
          checks: data.checks,
          simulated: false,
        };
      } else {
        const check = simulatedCheck(selectedService.id);
        sandboxResult = {
          service: selectedService,
          trustScore: 92,
          trustExplanation:
            "Sandbox-Testwert: In einer echten Prüfung würde dieser Wert aus Erreichbarkeit, Antwortzeit, Strukturtreue und PASS-Historie berechnet.",
          latestCheck: check,
          checks: [check],
          simulated: true,
        };
      }

      setResult(sandboxResult);
      window.localStorage.setItem("bond402:onboarding:x402", "done");
      setCurrentStep(4);
      toast({
        title: sandboxResult.simulated ? "Sandbox-Ablauf abgeschlossen" : "Echter Bond402-Check abgeschlossen",
        description: sandboxResult.simulated
          ? "Kein Netzwerk-Check und keine Zahlung wurden ausgeführt."
          : "Das echte Prüfergebnis wurde über die Developer-API gespeichert.",
      });
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Der Sandbox-Ablauf konnte nicht abgeschlossen werden.");
      setCurrentStep(3);
    } finally {
      setIsRunning(false);
    }
  };

  const resetSandbox = () => {
    setCurrentStep(-1);
    setResult(null);
    setError(null);
  };

  return (
    <Card id="x402-sandbox" className="scroll-mt-24 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card shadow-lg shadow-primary/5">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <WalletCards className="h-5 w-5 text-primary" />
              x402-Sandbox
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl">
              Erleben Sie einen zukünftigen maschinellen Bezahlablauf mit sicheren Testwerten. Es wird kein echtes Geld bewegt.
            </CardDescription>
          </div>
          <Badge variant="warning" className="gap-1">
            <Info className="h-3 w-3" /> Nur Test / Sandbox
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed text-foreground/85">
          <strong className="text-warning">Wichtig:</strong> Diese Demo nutzt ausschließlich 100 TEST-CREDITS als Anzeige. Es gibt keine Wallet, keine Blockchain-Transaktion, keinen echten x402-Zahlungsdienst und keine Kosten.
        </div>

        {services.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 p-6 text-center text-sm text-muted-foreground">
            Registrieren Sie zuerst einen eigenen Dienst, damit der Sandbox-Ablauf daran gezeigt werden kann.
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                <Label htmlFor="sandbox-service">Dienst für die Demo</Label>
                <select
                  id="sandbox-service"
                  value={selectedServiceId}
                  onChange={(event) => {
                    setSelectedServiceId(event.target.value);
                    resetSandbox();
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
                <Label htmlFor="sandbox-api-key" className="flex items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 text-primary" /> Optionaler Developer-API-Schlüssel
                </Label>
                <Input
                  id="sandbox-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder="b402_… (nur für diese Sitzung)"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Mit Schlüssel wird beim Schritt „Dienstprüfung“ der echte Bond402-Check ausgeführt. Der Schlüssel wird nicht gespeichert.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Simulierter Testfortschritt</span>
                <span>{currentStep < 0 ? "Bereit" : `${Math.min(currentStep + 1, steps.length)} / ${steps.length}`}</span>
              </div>
              <Progress value={currentStep < 0 ? 0 : ((currentStep + 1) / steps.length) * 100} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                {steps.map((step, index) => {
                  const Icon = step.icon;
                  const isDone = currentStep > index;
                  const isActive = currentStep === index;
                  return (
                    <div
                      key={step.label}
                      className={`rounded-xl border p-3 transition-colors ${
                        isActive
                          ? "border-primary bg-primary/10"
                          : isDone
                            ? "border-success/40 bg-success/5"
                            : "border-border/60 bg-muted/10"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <Icon className={`h-4 w-4 ${isActive || isDone ? "text-primary" : "text-muted-foreground"}`} />
                        {isDone ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : isActive ? (
                          <Circle className="h-4 w-4 animate-pulse text-primary" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground/50" />
                        )}
                      </div>
                      <p className="text-sm font-semibold">{step.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={runSandbox} disabled={isRunning || !selectedService} className="gap-2">
                <Play className="h-4 w-4" />
                {isRunning ? "Sandbox läuft …" : apiKey.trim() ? "Sandbox + echten Check starten" : "Sandbox starten"}
              </Button>
              {(result || error) && (
                <Button variant="outline" onClick={resetSandbox}>
                  Zurücksetzen
                </Button>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-semibold text-destructive">Prüfung nicht abgeschlossen</p>
                  <p className="mt-1 text-foreground/80">{error}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Die simulierten Zahlungsschritte haben keine echte Transaktion ausgelöst.</p>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-4 rounded-xl border border-success/30 bg-success/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-semibold">
                      <CheckCircle2 className="h-5 w-5 text-success" />
                      {result.simulated ? "Sandbox-Ergebnis" : "Echtes Bond402-Prüfergebnis"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{result.latestCheck?.summary}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Trust Score</p>
                    <p className="text-3xl font-bold text-primary">{result.trustScore === null ? "—" : `${result.trustScore}%`}</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Freigabe</p>
                    <p className="mt-1 font-mono text-sm text-success">0,01 TEST-CREDITS</p>
                  </div>
                  <div className="rounded-lg bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Prüfstatus</p>
                    <p className="mt-1 font-semibold">{result.latestCheck?.status || "—"}</p>
                  </div>
                  <div className="rounded-lg bg-background/60 p-3">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><History className="h-3 w-3" /> Gespeicherte Prüfungen</p>
                    <p className="mt-1 font-semibold">{result.checks.length}</p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{result.trustExplanation}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-success" />
                  {result.simulated
                    ? "Nur lokales Sandbox-Ergebnis — die Historie der echten Datenbank wurde nicht verändert."
                    : "Der echte Check wurde gespeichert und fließt in die Trust-Score-Historie ein."}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}