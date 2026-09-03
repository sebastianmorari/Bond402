import { Service, CheckResult } from '@/lib/store';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, Activity, ShieldCheck, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { TrustScoreIndicator } from './trust-score-indicator';

interface Props {
  service: Service;
  onClick: (service: Service) => void;
}

export function StatusBadge({ status }: { status: CheckResult['status'] }) {
  switch (status) {
    case 'PASS':
      return <Badge className="bg-success text-success-foreground hover:bg-success/90">Erfolgreich</Badge>;
    case 'FAIL':
      return <Badge className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Fehlerhaft</Badge>;
    case 'REVIEW':
      return <Badge className="bg-warning text-warning-foreground hover:bg-warning/90">Auffällig</Badge>;
    default:
      return <Badge variant="secondary">Unbekannt</Badge>;
  }
}

export function ServiceCard({ service, onClick }: Props) {
  const latestCheck = service.checks[0];

  return (
    <Card 
      className="group cursor-pointer hover:border-primary/40 hover:shadow-[0_0_20px_rgba(59,130,246,0.1)] transition-all duration-300 bg-card overflow-hidden"
      onClick={() => onClick(service)}
    >
      <CardHeader className="pb-4">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1">
            <CardTitle className="text-xl mb-1 group-hover:text-primary transition-colors">
              {service.name}
            </CardTitle>
            <div className="text-sm text-muted-foreground font-mono truncate max-w-[200px] sm:max-w-[240px]">
              {service.url}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <TrustScoreIndicator service={service} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-3 rounded-lg border border-border/50">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Activity className="w-3.5 h-3.5" /> Max. Antwortzeit
            </span>
            <span className="font-medium font-mono">{service.maxResponseTime}ms</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Clock className="w-3.5 h-3.5" /> Letzte Prüfung
            </span>
            <span className="font-medium">
              {latestCheck 
                ? formatDistanceToNow(latestCheck.timestamp, { addSuffix: true, locale: de }) 
                : 'Noch nie'}
            </span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="bg-muted/10 pt-4 border-t flex justify-between items-center text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span>{service.checks.length} Prüfungen</span>
        </div>
        <div className="flex items-center text-primary font-medium opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
          Details <ChevronRight className="w-4 h-4 ml-1" />
        </div>
      </CardFooter>
    </Card>
  );
}
