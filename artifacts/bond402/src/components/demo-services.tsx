import { useListDemoServices, useCreateService, getListServicesQueryKey, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Info, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";

interface DemoServicesProps {
  readOnly?: boolean;
}

export function DemoServices({ readOnly = false }: DemoServicesProps) {
  const { data: demoServices, isLoading, isError } = useListDemoServices();
  const createService = useCreateService();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleAddDemo = (demo: NonNullable<typeof demoServices>[number]) => {
    if (readOnly) return;
    
    createService.mutate(
      {
        data: {
          name: demo.name,
          url: demo.url,
          expectedStructure: demo.expectedStructure,
          maxResponseTime: demo.maxResponseTime,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          toast({
            title: "Beispiel-Dienst registriert",
            description: `${demo.name} wurde erfolgreich registriert.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Fehler",
            description: (error as any).data?.error || "Dienst konnte nicht hinzugefügt werden.",
            variant: "destructive",
          });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-card/50 rounded-lg animate-pulse" />
        <div className="h-24 bg-card/50 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-5 text-sm text-destructive">
        Beispiel-Dienste konnten nicht geladen werden. Bitte versuchen Sie es später erneut.
      </div>
    );
  }

  if (!demoServices || demoServices.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Beispiel-Dienste</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="w-[200px] text-xs">Öffentliche Beispiel-APIs, die Sie mit einem Klick registrieren können, um Live-Checks und Trust-Daten kennenzulernen.</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      
      {demoServices.map((demo, idx) => (
        <Card key={idx} className="bg-card/30 border-border/40 hover:bg-card/50 transition-colors">
          <CardHeader className="pb-2">
            <div className="flex justify-between items-start gap-4">
              <div>
                <CardTitle className="text-base">{demo.name}</CardTitle>
                <CardDescription className="text-xs font-mono mt-1 break-all">
                  {demo.url}
                </CardDescription>
              </div>
              {readOnly ? (
                <Button size="sm" variant="secondary" className="shrink-0" asChild>
                  <Link href="/sign-up">
                    <Lock className="h-4 w-4 mr-1" />
                    Anmelden
                  </Link>
                </Button>
              ) : (
                <Button 
                  size="sm" 
                  variant="secondary" 
                  onClick={() => handleAddDemo(demo)}
                  disabled={createService.isPending}
                  className="shrink-0"
                >
                  {createService.isPending ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-1" />
                  )}
                  Hinzufügen
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {demo.explanation}
            </p>
          </CardContent>
        </Card>
      ))}
      
      {readOnly && (
        <div className="mt-4 text-center">
          <Link href="/sign-up" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 w-full">
            Konto erstellen für eigenen API-Check
          </Link>
        </div>
      )}
    </div>
  );
}
