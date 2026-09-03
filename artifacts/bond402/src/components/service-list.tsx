import { useListServices } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, ShieldAlert, Globe, Clock, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";

interface ServiceListProps {
  onSelectService: (id: string) => void;
}

export function ServiceList({ onSelectService }: ServiceListProps) {
  const { data: services, isLoading, isError } = useListServices();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
        <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-80" />
        <p className="font-medium">Dienste konnten nicht geladen werden.</p>
        <p className="text-sm mt-1 opacity-80">Bitte versuchen Sie es später erneut.</p>
      </div>
    );
  }

  if (!services || services.length === 0) {
    return (
      <div className="p-12 text-center bg-card/30 border border-border/50 rounded-xl border-dashed">
        <Globe className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
        <h3 className="font-medium text-lg">Keine Dienste registriert</h3>
        <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
          Registrieren Sie Ihren ersten API-Dienst oder fügen Sie einen Demo-Dienst hinzu, um die Überwachung zu starten.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {services.map((service) => {
        const lastCheck = service.checks[0];
        
        return (
          <Card 
            key={service.id} 
            className="group cursor-pointer hover:border-primary/50 transition-all bg-card/50 hover:bg-card hover:shadow-md"
            onClick={() => onSelectService(service.id)}
          >
            <CardContent className="p-4 sm:p-5 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                {service.trustScore && service.trustScore > 80 ? (
                  <ShieldCheck className="h-5 w-5 text-success" />
                ) : service.trustScore && service.trustScore < 50 ? (
                  <ShieldAlert className="h-5 w-5 text-destructive" />
                ) : (
                  <Globe className="h-5 w-5 text-primary" />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-semibold text-base truncate pr-4">{service.name}</h4>
                  {lastCheck ? (
                    <Badge 
                      variant={lastCheck.status === "PASS" ? "default" : lastCheck.status === "FAIL" ? "destructive" : "secondary"}
                      className="shrink-0"
                    >
                      {lastCheck.status}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0">Neu</Badge>
                  )}
                </div>
                
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-mono truncate max-w-[200px] sm:max-w-[300px]" title={service.url}>
                    {service.url}
                  </span>
                  
                  {service.trustScore !== null && (
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary" />
                      Trust: {service.trustScore}%
                    </span>
                  )}
                  
                  {lastCheck && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Geprüft: {format(new Date(lastCheck.checkedAt), "HH:mm 'Uhr'", { locale: de })}
                    </span>
                  )}
                </div>
              </div>
              
              <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
