import { useListDemoServices, useCreateService, getListServicesQueryKey, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function DemoServices() {
  const { data: demoServices, isLoading } = useListDemoServices();
  const createService = useCreateService();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleAddDemo = (demo: NonNullable<typeof demoServices>[number]) => {
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
            title: "Demo-Dienst hinzugefügt",
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

  if (!demoServices || demoServices.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Demo-Dienste zum Ausprobieren</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="w-[200px] text-xs">Sichere, öffentliche APIs, die Sie mit einem Klick hinzufügen können, um das System zu testen.</p>
          </TooltipContent>
        </Tooltip>
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
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {demo.explanation}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
