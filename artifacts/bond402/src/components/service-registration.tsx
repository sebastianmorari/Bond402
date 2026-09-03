import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateService, getListServicesQueryKey, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const formSchema = z.object({
  name: z.string().min(2, "Name muss mindestens 2 Zeichen lang sein").max(100, "Name darf maximal 100 Zeichen lang sein"),
  url: z.string().url("Muss eine gültige URL sein (http:// oder https://)").max(2048),
  expectedStructure: z.string().min(1, "Struktur darf nicht leer sein").max(4000, "Struktur ist zu lang"),
  maxResponseTime: z.coerce.number().min(100, "Mindestens 100ms").max(15000, "Maximal 15000ms"),
});

type FormValues = z.infer<typeof formSchema>;

export function ServiceRegistration({ onSuccess }: { onSuccess?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createService = useCreateService();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      url: "",
      expectedStructure: '{"status": "ok"}',
      maxResponseTime: 1000,
    },
  });

  const onSubmit = (data: FormValues) => {
    createService.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "Erfolg", description: "API-Dienst wurde registriert." });
          queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          form.reset();
          onSuccess?.();
        },
        onError: (error) => {
          toast({
            title: "Fehler bei der Registrierung",
            description: error.data?.error || "Ein unbekannter Fehler ist aufgetreten.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader>
        <CardTitle>Neuen Dienst registrieren</CardTitle>
        <CardDescription>
          Fügen Sie einen eigenen API-Endpunkt hinzu, um ihn durch Bond402 überwachen zu lassen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dienstname</FormLabel>
                  <FormControl>
                    <Input placeholder="z.B. Wetter API" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://api.example.com/data" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="maxResponseTime"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormLabel>Max. Antwortzeit (ms)</FormLabel>
                    <Tooltip>
                      <TooltipTrigger type="button">
                        <Info className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="w-[200px] text-xs">Wie lange darf die API maximal brauchen, bis sie antwortet? Standard ist 1000ms (1 Sekunde).</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expectedStructure"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormLabel>Erwartete JSON-Struktur</FormLabel>
                    <Tooltip>
                      <TooltipTrigger type="button">
                        <Info className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="w-[250px] text-xs">Ein JSON-Muster, das die erforderlichen Felder definiert. Die Antwort der API wird dagegen geprüft.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <FormControl>
                    <Textarea 
                      placeholder={'{"id": "number", "name": "string"}'} 
                      className="font-mono text-sm h-24"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={createService.isPending}>
              {createService.isPending ? "Registriert..." : "Dienst registrieren"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
