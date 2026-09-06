import { useCallback, useEffect, useState } from "react";
import { developerPreActionCheck, getGetUsageQueryKey, useGetUsage } from "@workspace/api-client-react";
import type { DeveloperPreActionCheck } from "@workspace/api-client-react";
import { Activity, AlertTriangle, Ban, CheckCircle2, Clock3, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type TestService = {
  id: string;
  name: string;
  url: string;
};

type PreActionTesterProps = {
  services: TestService[];
};

const decisionMeta = {
  ALLOW: {
    label: "ALLOW",
    title: "Nutzung freigegeben",
    description: "Die aktuellen Bond402-Daten sprechen für eine Nutzung dieses Dienstes.",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: ShieldCheck,
  },
  CAUTION: {
    label: "CAUTION",
    title: "Mit Vorsicht fortfahren",
    description: "Es gibt Signale, die ein Agent vor der Aktion berücksichtigen sollte.",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: AlertTriangle,
  },
  BLOCK: {
    label: "BLOCK",
    title: "Nutzung blockieren",
    description: "Die aktuellen Daten sprechen gegen eine automatisierte Nutzung dieses Dienstes.",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: Ban,
  },
} as const;

function factorLabel(value: boolean | null, positive: string, negative: string) {
  if (value === null) return "Keine Daten";
  return value ? positive : negative;
}

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return "Der Pre-Action-Check konnte nicht ausgeführt werden. Prüfen Sie Schlüssel und Dienst und versuchen Sie es erneut.";
}

export function PreActionTester({ services }: PreActionTesterProps) {
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [sessionApiKey, setSessionApiKey] = useState("");
  const [result, setResult] = useState<DeveloperPreActionCheck | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const queryClient = useQueryClient();
  const { data: usage } = useGetUsage();
  const { toast } = useToast();

  useEffect(() => {
    if (!services.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId(services[0]?.id ?? "");
      setResult(null);
    }
  }, [services, selectedServiceId]);

  const handleRunCheck = useCallback(async () => {
    const apiKey = sessionApiKey.trim();
    if (!selectedServiceId) {
      setErrorMessage("Bitte wählen Sie zuerst einen registrierten Dienst aus.");
      return;
    }
    if (!apiKey) {
      setErrorMessage("Bitte geben Sie für diesen Sitzungstest einen Developer-API-Key ein.");
      return;
    }

    setIsChecking(true);
    setErrorMessage(null);
    setResult(null);
    try {
      const checkResult = await developerPreActionCheck(selectedServiceId, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      setResult(checkResult);
      toast({
        title: `${checkResult.decision} – Pre-Action-Check abgeschlossen`,
        description: "Das Monatskontingent wurde für diese produktive Prüfung aktualisiert.",
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      await queryClient.invalidateQueries({ queryKey: getGetUsageQueryKey() });
      setIsChecking(false);
    }
  }, [queryClient, selectedServiceId, sessionApiKey, toast]);

  const clearSessionKey = useCallback(() => {
    setSessionApiKey("");
    setResult(null);
    setErrorMessage(null);
  }, []);

  const selectedService = services.find((service) => service.id === selectedServiceId);
  const decision = result ? decisionMeta[result.decision] : null;
  const DecisionIcon = decision?.icon;

  return (
    <Card className="border-primary/20 bg-card/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Pre-Action-Check testen
        </CardTitle>
        <CardDescription>
          Testen Sie den echten Developer-Endpunkt mit einem eigenen Dienst. Der Schlüssel bleibt nur im Arbeitsspeicher dieser geöffneten Sitzung und wird nicht gespeichert.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {services.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Noch kein eigener Dienst vorhanden</p>
            <p className="mt-1">Registrieren Sie zuerst einen Dienst im Dashboard, damit Sie ihn hier für einen Agenten-Check auswählen können.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium">
                <span>Registrierten Dienst auswählen</span>
                <select
                  value={selectedServiceId}
                  onChange={(event) => {
                    setSelectedServiceId(event.target.value);
                    setResult(null);
                    setErrorMessage(null);
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Registrierten Dienst auswählen"
                >
                  <option value="" disabled>
                    Dienst auswählen
                  </option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name} – {service.url}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm font-medium">
                <span>Developer-API-Key für diese Sitzung</span>
                <Input
                  type="password"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="b402_…"
                  value={sessionApiKey}
                  onChange={(event) => {
                    setSessionApiKey(event.target.value);
                    setErrorMessage(null);
                  }}
                  aria-label="Developer-API-Key für diese Sitzung"
                />
              </label>
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  Der Schlüssel wird weder in der Datenbank noch in localStorage gespeichert. Ein erfolgreicher Test verbraucht regulär einen Check.
                </span>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearSessionKey}
                  disabled={!sessionApiKey && !result}
                  className="w-full sm:w-auto"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Sitzungsschlüssel löschen
                </Button>
                <Button
                  type="button"
                  onClick={handleRunCheck}
                  disabled={isChecking || !selectedServiceId || !sessionApiKey.trim()}
                  className="w-full sm:w-auto"
                >
                  {isChecking ? "Prüfung läuft …" : "Pre-Action-Check testen"}
                </Button>
              </div>
            </div>

            {selectedService && (
              <p className="text-xs text-muted-foreground">
                Ausgewählt: <span className="font-medium text-foreground">{selectedService.name}</span>
              </p>
            )}

            {errorMessage && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm leading-6 text-destructive">
                {errorMessage}
              </div>
            )}

            {result && decision && DecisionIcon && (
              <div className="space-y-4 rounded-2xl border border-border/70 bg-background/50 p-4 sm:p-5">
                <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center ${decision.className}`}>
                  <DecisionIcon className="h-8 w-8 shrink-0" />
                  <div>
                    <p className="text-xl font-bold tracking-tight">{decision.label}</p>
                    <p className="font-semibold">{decision.title}</p>
                    <p className="mt-1 text-sm opacity-90">{decision.description}</p>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold">Warum diese Entscheidung?</h4>
                  <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
                    {result.reasons.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-primary" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-sm font-semibold">Maschinenlesbare Faktoren</h4>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                      <dt className="text-xs text-muted-foreground">Trust Score</dt>
                      <dd className="mt-1 font-semibold">{result.factors.trustScore ?? "Keine Daten"}</dd>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                      <dt className="text-xs text-muted-foreground">Letzter Status</dt>
                      <dd className="mt-1 font-semibold">{result.factors.latestStatus ?? "Keine Prüfung"}</dd>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                      <dt className="text-xs text-muted-foreground">Erreichbarkeit</dt>
                      <dd className="mt-1 font-semibold">{factorLabel(result.factors.latestReachable, "Erreichbar", "Nicht erreichbar")}</dd>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                      <dt className="text-xs text-muted-foreground">Struktur</dt>
                      <dd className="mt-1 font-semibold">{factorLabel(result.factors.latestStructureMatch, "Treue Struktur", "Abweichende Struktur")}</dd>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                      <dt className="text-xs text-muted-foreground">Antwortzeit</dt>
                      <dd className="mt-1 font-semibold">
                        {result.factors.latestResponseTimeMs === null ? "Keine Daten" : `${result.factors.latestResponseTimeMs} ms`}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
                      <dt className="text-xs text-muted-foreground">Historie</dt>
                      <dd className="mt-1 font-semibold">
                        {result.factors.recentPasses} PASS · {result.factors.recentFailures} FAIL
                      </dd>
                      <p className="text-xs text-muted-foreground">{result.factors.recentLiveChecks} Livechecks</p>
                    </div>
                  </dl>
                </div>

                <div className="flex flex-col gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5" />
                    Ausgewertet am {format(new Date(result.evaluatedAt), "dd.MM.yyyy, HH:mm", { locale: de })} Uhr
                  </span>
                  <span>
                    {usage?.usedChecks.toLocaleString("de-CH") ?? "…"} verbraucht ·{" "}
                    {usage?.remainingChecks === null ? "unbegrenzt" : usage?.remainingChecks.toLocaleString("de-CH") ?? "…"} verbleibend
                  </span>
                </div>

                {result.factors.anomalies.length > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm">
                    <p className="font-semibold text-amber-700 dark:text-amber-300">Auffälligkeiten</p>
                    <p className="mt-1 text-muted-foreground">{result.factors.anomalies.join(" · ")}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}