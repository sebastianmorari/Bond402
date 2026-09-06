import { useGetUsage } from "@workspace/api-client-react";
import { CalendarClock, CreditCard, Gauge, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

function formatLimit(value: number | null) {
  return value === null ? "Individuell" : value.toLocaleString("de-CH");
}

export function QuotaCard() {
  const { data, isLoading, isError } = useGetUsage();

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-2xl border border-border/50 bg-card/40" />;
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
        Nutzungsdaten konnten nicht geladen werden.
      </div>
    );
  }

  const percentage =
    data.monthlyLimit === null
      ? 0
      : Math.min(100, Math.round((data.usedChecks / data.monthlyLimit) * 100));
  const resetDate = new Date(data.resetAt).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <Card className="border-primary/20 bg-card/60">
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Trust Firewall-Kontingent
          </CardTitle>
          <CardDescription>
            Produktive Live-, manuelle und Agenten-Vorabchecks. Demo- und Sandbox-Abläufe sind kostenlos simuliert.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
          <Sparkles className="h-4 w-4" />
          {data.planName}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-background/50 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Verbraucht</p>
            <p className="mt-1 text-2xl font-bold">{data.usedChecks.toLocaleString("de-CH")}</p>
            <p className="text-xs text-muted-foreground">Checks diesen Monat</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/50 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Verbleibend</p>
            <p className="mt-1 text-2xl font-bold">
              {data.remainingChecks === null ? "∞" : data.remainingChecks.toLocaleString("de-CH")}
            </p>
            <p className="text-xs text-muted-foreground">von {formatLimit(data.monthlyLimit)}</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/50 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Reset</p>
            <p className="mt-1 text-base font-bold">{resetDate}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarClock className="h-3 w-3" />
              automatisch monatlich
            </p>
          </div>
        </div>

        {data.monthlyLimit !== null && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{percentage}% genutzt</span>
              <span>{data.monthlyLimit.toLocaleString("de-CH")} Checks inklusive</span>
            </div>
            <Progress value={percentage} aria-label={`${percentage}% des monatlichen Kontingents genutzt`} />
          </div>
        )}

        {data.remainingChecks === 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-warning-foreground">
            Ihr monatliches Kontingent ist verbraucht. Weitere Produktchecks werden sicher blockiert.
            Die Paket-Upgrades sind vorbereitet, aber noch nicht buchbar und lösen keine Zahlung aus.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {data.availablePlans.map((plan) => (
            <div
              key={plan.plan}
              className={`rounded-xl border p-3 ${
                plan.plan === data.plan ? "border-primary bg-primary/5" : "border-border/60 bg-background/30"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{plan.planName}</span>
                {plan.plan === data.plan && <span className="text-[10px] font-bold uppercase text-primary">Aktuell</span>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.priceChf === null ? "Auf Anfrage" : plan.priceChf === 0 ? "Kostenlos" : `${plan.priceChf} CHF / Monat`}
              </p>
              <p className="mt-2 text-sm font-medium">{formatLimit(plan.monthlyLimit)} Checks</p>
              {plan.plan !== data.plan && (
                <Button variant="outline" size="sm" className="mt-3 w-full" disabled title="Noch nicht buchbar">
                  <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                  Bald verfügbar
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Upgrade-Schaltflächen erklären das spätere Paketmodell. Es werden aktuell keine Zahlungen ausgelöst und kein Zahlungsanbieter benötigt.
        </p>
      </CardContent>
    </Card>
  );
}