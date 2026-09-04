import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  KeyRound,
  PlayCircle,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  getGetDashboardQueryKey,
  getListApiKeysQueryKey,
  getListServicesQueryKey,
  useCreateApiKey,
  useCreateService,
  useListApiKeys,
  useListDemoServices,
  useListServices,
  useRunServiceCheck,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const X402_DONE_KEY = "bond402:onboarding:x402";
const BOND_DONE_KEY = "bond402:onboarding:bond";

export function GuidedOnboarding() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: services = [], isLoading: servicesLoading } = useListServices();
  const { data: demoServices = [] } = useListDemoServices();
  const { data: apiKeys = [] } = useListApiKeys();
  const createService = useCreateService();
  const runCheck = useRunServiceCheck();
  const createApiKey = useCreateApiKey();
  const [x402Done, setX402Done] = useState(false);
  const [bondDone, setBondDone] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  useEffect(() => {
    setX402Done(window.localStorage.getItem(X402_DONE_KEY) === "done");
    setBondDone(window.localStorage.getItem(BOND_DONE_KEY) === "done");
  }, []);

  const firstDemo = demoServices[0];
  const selectedService = services[0];
  const hasCheck = services.some((service) => service.checks?.length > 0);
  const hasActiveKey = apiKeys.some((key) => !key.revokedAt);
  const completedCount = [true, services.length > 0, hasCheck, hasActiveKey, x402Done, bondDone].filter(Boolean).length;
  const activeStep = useMemo(() => {
    if (servicesLoading) return 1;
    if (!services.length) return 2;
    if (!hasCheck) return 3;
    if (!hasActiveKey) return 4;
    if (!x402Done) return 5;
    if (!bondDone) return 6;
    return 7;
  }, [bondDone, hasActiveKey, hasCheck, services.length, servicesLoading, x402Done]);

  function refreshData() {
    queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
  }

  function addDemoService() {
    if (!firstDemo || createService.isPending) return;
    createService.mutate(
      {
        data: {
          name: firstDemo.name,
          url: firstDemo.url,
          expectedStructure: firstDemo.expectedStructure,
          maxResponseTime: firstDemo.maxResponseTime,
        },
      },
      {
        onSuccess: () => {
          refreshData();
          toast({ title: "Demo-Dienst übernommen", description: "Als Nächstes starten Sie die erste Prüfung." });
        },
        onError: (error) => {
          toast({ title: "Demo-Dienst konnte nicht übernommen werden", description: error.data?.error || "Bitte versuchen Sie es erneut.", variant: "destructive" });
        },
      },
    );
  }

  function runFirstCheck() {
    if (!selectedService || runCheck.isPending) return;
    runCheck.mutate(
      { id: selectedService.id },
      {
        onSuccess: () => {
          refreshData();
          toast({ title: "Erste Prüfung abgeschlossen", description: "Als Nächstes können Sie einen Developer-Schlüssel anlegen." });
        },
        onError: (error) => {
          toast({ title: "Prüfung nicht abgeschlossen", description: error.data?.error || "Bitte prüfen Sie die Dienst-URL.", variant: "destructive" });
        },
      },
    );
  }

  function createDemoKey() {
    if (createApiKey.isPending) return;
    createApiKey.mutate(
      { data: { name: "Bond402 Demo-Schlüssel" } },
      {
        onSuccess: (data) => {
          setNewSecret(data.secret);
          refreshData();
          toast({ title: "Developer-Schlüssel erstellt", description: "Speichern Sie ihn jetzt sicher. Er wird später nicht noch einmal vollständig angezeigt." });
        },
        onError: (error) => {
          toast({ title: "Schlüssel konnte nicht erstellt werden", description: error.data?.error || "Bitte versuchen Sie es erneut.", variant: "destructive" });
        },
      },
    );
  }

  const steps = [
    {
      number: 1,
      title: "Konto ist bereit",
      description: "Sie sind angemeldet. Alle folgenden Daten gehören nur zu Ihrem Konto.",
      done: true,
      icon: ShieldCheck,
    },
    {
      number: 2,
      title: "Dienst auswählen",
      description: "Übernehmen Sie einen sicheren öffentlichen Demo-Dienst oder legen Sie unten einen eigenen Testdienst an.",
      done: services.length > 0,
      icon: Server,
      action: services.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={addDemoService} disabled={!firstDemo || createService.isPending} className="gap-2">
            {createService.isPending ? "Wird übernommen …" : "Demo-Dienst übernehmen"}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button asChild variant="outline">
            <a href="#service-registration">Eigenen Testdienst anlegen</a>
          </Button>
        </div>
      ) : null,
    },
    {
      number: 3,
      title: "Erste Prüfung starten",
      description: "Bond402 ruft den Dienst sicher auf und berechnet daraus den ersten Trust Score.",
      done: hasCheck,
      icon: PlayCircle,
      action: !hasCheck && selectedService ? (
        <Button onClick={runFirstCheck} disabled={runCheck.isPending} className="gap-2">
          {runCheck.isPending ? "Prüfung läuft …" : "Erste Prüfung starten"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      ) : null,
    },
    {
      number: 4,
      title: "Developer-Schlüssel anlegen",
      description: "Der Schlüssel ist für Automatisierung gedacht. Im Testablauf wird er nur lokal im Browser verwendet.",
      done: hasActiveKey,
      icon: KeyRound,
      action: !hasActiveKey ? (
        <Button onClick={createDemoKey} disabled={createApiKey.isPending} className="gap-2">
          {createApiKey.isPending ? "Wird erstellt …" : "Demo-Schlüssel erstellen"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      ) : null,
    },
    {
      number: 5,
      title: "x402-Sandbox ansehen",
      description: "Nur simulierte Test-Credits, keine Wallet und keine echte Zahlung.",
      done: x402Done,
      icon: Sparkles,
      action: !x402Done ? (
        <Button asChild className="gap-2">
          <Link href="/x402-sandbox">x402-Sandbox öffnen <ArrowRight className="h-4 w-4" /></Link>
        </Button>
      ) : null,
    },
    {
      number: 6,
      title: "Bond & Reputation simulieren",
      description: "Nur Test-BONDS und lokale Testpunkte. Es wird nichts gebucht oder gespeichert.",
      done: bondDone,
      icon: ShieldCheck,
      action: !bondDone ? (
        <Button asChild className="gap-2">
          <Link href="/bond-sandbox">Bond-Sandbox öffnen <ArrowRight className="h-4 w-4" /></Link>
        </Button>
      ) : null,
    },
  ];

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card shadow-lg shadow-primary/5">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Ihr Bond402-Testablauf
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl">
              Folgen Sie den Schritten in dieser Reihenfolge. Sie brauchen keine Programmierkenntnisse und können jederzeit zurückkehren.
            </CardDescription>
          </div>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {completedCount}/6 erledigt
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((step) => {
          const Icon = step.icon;
          const isCurrent = activeStep === step.number;
          return (
            <div
              key={step.number}
              className={`rounded-xl border p-4 transition-colors ${
                isCurrent ? "border-primary bg-primary/10" : step.done ? "border-success/30 bg-success/5" : "border-border/60 bg-muted/10"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {step.done ? <CheckCircle2 className="h-5 w-5 text-success" /> : isCurrent ? <Icon className="h-5 w-5 text-primary" /> : <Circle className="h-5 w-5 text-muted-foreground/50" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    <span className="mr-2 text-xs uppercase tracking-wider text-muted-foreground">Schritt {step.number}</span>
                    {step.title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
                  {isCurrent && step.action && <div className="mt-3">{step.action}</div>}
                </div>
              </div>
            </div>
          );
        })}
        {newSecret && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
            <p className="font-semibold text-warning">Ihr Demo-Schlüssel wird nur jetzt vollständig angezeigt.</p>
            <code className="mt-2 block break-all rounded-lg bg-background/70 p-3 font-mono text-xs">{newSecret}</code>
            <p className="mt-2 text-xs text-muted-foreground">Speichern Sie ihn nur, wenn Sie ihn später für die Developer-API benötigen.</p>
          </div>
        )}
        {activeStep === 7 && (
          <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm">
            <p className="font-semibold text-success">Testablauf abgeschlossen.</p>
            <p className="mt-1 text-muted-foreground">Sie haben die wichtigsten Bond402-Funktionen sicher und ohne echte Zahlungen ausprobiert.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}