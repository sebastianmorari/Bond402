import { useGetDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, ShieldCheck, Clock, Layers, Gauge, TimerReset } from "lucide-react";

export function DashboardMetrics() {
  const { data, isLoading, isError } = useGetDashboard();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-destructive/10 text-destructive border-destructive/20 border p-4 rounded-xl">
        <p className="text-sm font-medium">Metriken konnten nicht geladen werden.</p>
      </div>
    );
  }

  const metrics = [
    {
      title: "Registrierte Dienste",
      value: data.serviceCount,
      icon: Layers,
      description: "Aktive API-Schnittstellen",
    },
    {
      title: "Gesamtprüfungen",
      value: data.checkCount,
      icon: Activity,
      description: "Durchgeführte Tests",
    },
    {
      title: "Erfolgsquote",
      value: `${data.passRate.toFixed(1)}%`,
      icon: ShieldCheck,
      description: "Erfolgreiche Überprüfungen",
    },
    {
      title: "Ø Antwortzeit",
      value: `${Math.round(data.averageResponseTimeMs)} ms`,
      icon: Clock,
      description: "Durchschnittliche Latenz",
    },
    {
      title: "Beobachtete Uptime",
      value: data.uptimePercent === null ? "—" : `${data.uptimePercent.toFixed(1)}%`,
      icon: Gauge,
      description: "Gewichtete Live-Erreichbarkeit",
    },
    {
      title: "p95 / p99 Latenz",
      value:
        data.p95ResponseTimeMs === null || data.p99ResponseTimeMs === null
          ? "—"
          : `${data.p95ResponseTimeMs} / ${data.p99ResponseTimeMs} ms`,
      icon: TimerReset,
      description: `${data.timedSampleCount} zeitgemessene Livechecks`,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {metrics.map((metric) => (
        <Card key={metric.title} className="bg-card/50 border-border/50 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {metric.title}
            </CardTitle>
            <metric.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{metric.value}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {metric.description}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
