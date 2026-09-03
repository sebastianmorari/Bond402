import { calculateTrustScore, Service } from '@/lib/store';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Props {
  service: Service;
  showDetails?: boolean;
}

export function TrustScoreIndicator({ service, showDetails = false }: Props) {
  const { score, explanation, reachabilityRate, performanceRate, structureRate } = calculateTrustScore(service);

  if (score === null) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="font-mono text-sm bg-muted px-2 py-1 rounded-md">N/A</span>
        <span className="text-xs">Keine Daten</span>
      </div>
    );
  }

  const getColorClass = (s: number) => {
    if (s >= 90) return 'text-success border-success bg-success/10 shadow-[0_0_10px_rgba(16,185,129,0.2)]';
    if (s >= 70) return 'text-primary border-primary bg-primary/10 shadow-[0_0_10px_rgba(59,130,246,0.2)]';
    if (s >= 40) return 'text-warning border-warning bg-warning/10 shadow-[0_0_10px_rgba(245,158,11,0.2)]';
    return 'text-destructive border-destructive bg-destructive/10 shadow-[0_0_10px_rgba(239,68,68,0.2)]';
  };

  const colorClass = getColorClass(score);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger className="cursor-help">
            <div className={`flex items-center justify-center w-12 h-12 rounded-full border-2 ${colorClass} font-mono font-bold text-lg transition-transform hover:scale-105`}>
              {score}
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs p-4 space-y-3 bg-card border-border/50 text-card-foreground shadow-xl">
            <p className="font-semibold text-sm">Trust Score: {score}/100</p>
            <p className="text-xs text-muted-foreground">{explanation}</p>
            <div className="pt-3 mt-3 border-t border-border/50 text-xs space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Erreichbarkeit (40%):</span>
                <span className="font-medium">{reachabilityRate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Geschwindigkeit (30%):</span>
                <span className="font-medium">{performanceRate}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Struktur (30%):</span>
                <span className="font-medium">{structureRate}%</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
        
        {showDetails && (
          <div className="flex flex-col">
            <span className="font-semibold text-sm">Trust Score</span>
            <span className="text-xs text-muted-foreground max-w-[200px] truncate" title={explanation}>
              {explanation}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
