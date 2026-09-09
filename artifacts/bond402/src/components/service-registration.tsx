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
  expectedStructure: z.string().max(4000, "Struktur ist zu lang"),
  responseMode: z.enum(["JSON", "HTTP"]),
  maxResponseTime: z.coerce.number().min(100, "Mindestens 100ms").max(15000, "Maximal 15000ms"),
  requestMethod: z.enum(["GET", "POST"]),
  targetAuthType: z.enum(["NONE", "BEARER", "API_KEY_HEADER"]),
  targetAuthHeaderName: z.string().max(128).optional(),
  targetAuthSecret: z.string().max(4096).optional(),
  requestBody: z.string().max(64000).optional(),
}).superRefine((data, context) => {
  if (data.responseMode === "JSON" && !data.expectedStructure.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expectedStructure"],
      message: "Für JSON-Prüfungen wird eine erwartete Struktur benötigt.",
    });
  }
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
      responseMode: "JSON",
      maxResponseTime: 1000,
      requestMethod: "GET",
      targetAuthType: "NONE",
      targetAuthHeaderName: "X-API-Key",
      targetAuthSecret: "",
      requestBody: "",
    },
  });
  const requestMethod = form.watch("requestMethod");
  const responseMode = form.watch("responseMode");
  const targetAuthType = form.watch("targetAuthType");

  const onSubmit = (data: FormValues) => {
    let requestBody: Record<string, unknown> | undefined;
    if (data.requestBody?.trim()) {
      try {
        const parsed = JSON.parse(data.requestBody);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
          throw new Error("not an object");
        }
        requestBody = parsed as Record<string, unknown>;
      } catch {
        toast({
          title: "Ungültiger JSON-Body",
          description: "Der Request-Body muss ein gültiges JSON-Objekt sein.",
          variant: "destructive",
        });
        return;
      }
    }

    const {
      requestBody: _requestBody,
      expectedStructure: _expectedStructure,
      ...rest
    } = data;
    const expectedStructure =
      data.responseMode === "JSON" ? data.expectedStructure.trim() : undefined;
    createService.mutate(
      {
        data: {
          ...rest,
          ...(expectedStructure ? { expectedStructure } : {}),
          ...(requestBody ? { requestBody } : {}),
          ...(data.targetAuthSecret?.trim()
            ? { targetAuthSecret: data.targetAuthSecret.trim() }
            : {}),
          ...(data.targetAuthType === "API_KEY_HEADER"
            ? { targetAuthHeaderName: data.targetAuthHeaderName?.trim() }
            : {}),
        },
      },
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
              name="responseMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Antwortmodus</FormLabel>
                  <FormControl>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      {...field}
                    >
                      <option value="JSON">JSON-Struktur prüfen</option>
                      <option value="HTTP">Allgemeiner HTTP/HTTPS-Check</option>
                    </select>
                  </FormControl>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {responseMode === "JSON"
                      ? "Die erfolgreiche Antwort muss gültiges JSON liefern und die erwarteten Felder enthalten."
                      : "Prüft Erreichbarkeit, HTTP-Status, HTTPS/TLS, Security-Header und Latenz. HTML und anderer Textinhalt sind erlaubt."}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {responseMode === "JSON" && (
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
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="requestMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prüfmethode</FormLabel>
                    <FormControl>
                      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...field}>
                        <option value="GET">GET – liest Daten</option>
                        <option value="POST">POST – kann Aktionen auslösen</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="targetAuthType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Zielauthentifizierung</FormLabel>
                    <FormControl>
                      <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...field}>
                        <option value="NONE">Keine</option>
                        <option value="BEARER">Bearer-Token</option>
                        <option value="API_KEY_HEADER">API-Key im Header</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {targetAuthType === "API_KEY_HEADER" && (
              <FormField
                control={form.control}
                name="targetAuthHeaderName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API-Key-Header</FormLabel>
                    <FormControl><Input placeholder="X-API-Key" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">Host-, Cookie-, Proxy- und Forwarding-Header sind nicht erlaubt.</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {targetAuthType !== "NONE" && (
              <FormField
                control={form.control}
                name="targetAuthSecret"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{targetAuthType === "BEARER" ? "Bearer-Token" : "API-Key"}</FormLabel>
                    <FormControl><Input type="password" autoComplete="new-password" placeholder="Wird verschlüsselt gespeichert" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">Das Secret wird nicht öffentlich angezeigt, geloggt oder in Prüfhistorien gespeichert.</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {requestMethod === "POST" && (
              <FormField
                control={form.control}
                name="requestBody"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>JSON-Request-Body (optional)</FormLabel>
                    <FormControl>
                      <Textarea className="font-mono text-sm min-h-28" placeholder={'{"query":"example"}'} {...field} />
                    </FormControl>
                    <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                      POST kann Kosten verursachen oder Seiteneffekte auslösen. Bond402 sendet den Body bei jeder Live-Prüfung an den Zielservice.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button type="submit" className="w-full" disabled={createService.isPending}>
              {createService.isPending ? "Registriert..." : "Dienst registrieren"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
