import { useState, useEffect } from "react";
import { 
  useGetService, 
  useDeleteService, 
  useUpdateService,
  useRunServiceCheck, 
  useVerifyServiceResponse,
  useIssueDomainVerification,
  useCheckDomainVerification,
  getListServicesQueryKey,
  getGetDashboardQueryKey,
  getGetServiceQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Sheet, 
  SheetContent, 
  SheetDescription, 
  SheetHeader, 
  SheetTitle
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  Trash2, 
  Play, 
  ShieldAlert, 
  ShieldCheck, 
  Clock, 
  Activity,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Save,
  Pencil
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { checkStatusLabel, checkTypeLabel } from "@/lib/presentation";

interface ServiceDetailsProps {
  serviceId: string | null;
  onClose: () => void;
}

export function ServiceDetails({ serviceId, onClose }: ServiceDetailsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [manualResponse, setManualResponse] = useState("");
  const [domainToken, setDomainToken] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [postConfirmationOpen, setPostConfirmationOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    url: "",
    maxResponseTime: 1000,
    expectedStructure: "",
    visibility: "PRIVATE" as "PRIVATE" | "LISTED",
    requestMethod: "GET" as "GET" | "POST",
    targetAuthType: "NONE" as "NONE" | "BEARER" | "API_KEY_HEADER",
    targetAuthHeaderName: "",
    targetAuthSecret: "",
    requestBodyText: "",
  });

  const { data: service, isLoading, isError } = useGetService(serviceId || "", {
    query: {
      enabled: !!serviceId,
      queryKey: serviceId ? getGetServiceQueryKey(serviceId) : ["_empty_"],
    }
  });

  useEffect(() => {
    if (service && !isEditing) {
      setEditForm({
        name: service.name,
        url: service.url,
        maxResponseTime: service.maxResponseTime,
        expectedStructure: service.expectedStructure,
        visibility: service.visibility,
        requestMethod: service.requestMethod,
        targetAuthType: service.targetAuthType,
        targetAuthHeaderName: service.targetAuthHeaderName ?? "",
        targetAuthSecret: "",
        requestBodyText: service.requestBody ? JSON.stringify(service.requestBody, null, 2) : "",
      });
    }
  }, [service, isEditing]);

  const runCheck = useRunServiceCheck();
  const verifyManual = useVerifyServiceResponse();
  const deleteService = useDeleteService();
  const updateService = useUpdateService();
  const issueDomainVerification = useIssueDomainVerification();
  const checkDomainVerification = useCheckDomainVerification();

  const startLiveCheck = () => {
    if (!serviceId) return;
    setPostConfirmationOpen(false);
    runCheck.mutate(
      { id: serviceId },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getGetServiceQueryKey(serviceId) });
          queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          toast({
            title: result.status === "PASS" ? "Prüfung bestanden" : "Prüfung fehlgeschlagen",
            description: result.summary,
            variant: result.status === "PASS" ? "default" : "destructive",
          });
        },
        onError: (error) => {
          toast({
            title: "Fehler bei der Prüfung",
            description: error.data?.error || "Die Verbindung konnte nicht hergestellt werden.",
            variant: "destructive",
          });
        }
      }
    );
  };

  const handleRunLiveCheck = () => {
    if (service?.requestMethod === "POST") {
      setPostConfirmationOpen(true);
      return;
    }
    startLiveCheck();
  };

  const handleManualVerify = () => {
    if (!serviceId || !manualResponse.trim()) return;
    verifyManual.mutate(
      { id: serviceId, data: { actualResponse: manualResponse } },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getGetServiceQueryKey(serviceId) });
          queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          setManualResponse("");
          toast({
            title: result.status === "PASS" ? "Struktur gültig" : "Strukturfehler erkannt",
            description: result.summary,
            variant: result.status === "PASS" ? "default" : "destructive",
          });
        },
        onError: (error) => {
          toast({
            title: "Überprüfungsfehler",
            description: error.data?.error || "Das JSON konnte nicht verarbeitet werden.",
            variant: "destructive",
          });
        }
      }
    );
  };

  const handleIssueDomainVerification = () => {
    if (!serviceId) return;
    issueDomainVerification.mutate(
      { id: serviceId },
      {
        onSuccess: (result) => {
          setDomainToken(result.token);
          queryClient.invalidateQueries({ queryKey: getGetServiceQueryKey(serviceId) });
          toast({ title: "Token erstellt", description: "Legen Sie den Token unter der Well-Known-Adresse Ihres Dienstes ab." });
        },
        onError: () => toast({ title: "Token konnte nicht erstellt werden", variant: "destructive" }),
      },
    );
  };

  const handleCheckDomainVerification = () => {
    if (!serviceId) return;
    checkDomainVerification.mutate(
      { id: serviceId },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getGetServiceQueryKey(serviceId) });
          toast({
            title: result.status === "VERIFIED" ? "Domain verifiziert" : "Noch nicht verifiziert",
            description: result.reason,
            variant: result.status === "VERIFIED" ? "default" : "destructive",
          });
        },
        onError: (error) => toast({ title: "Verifizierung fehlgeschlagen", description: error.data?.error, variant: "destructive" }),
      },
    );
  };

  const handleDelete = () => {
    if (!serviceId) return;
    deleteService.mutate(
      { id: serviceId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          toast({ title: "Dienst entfernt", description: "Der Dienst und seine Historie wurden gelöscht." });
          onClose();
        },
        onError: (error) => {
          toast({ title: "Fehler", description: error.data?.error || "Konnte nicht gelöscht werden.", variant: "destructive" });
        }
      }
    );
  };

  const handleUpdate = () => {
    if (!serviceId) return;
    let requestBody: Record<string, unknown> | null = null;
    if (editForm.requestBodyText.trim()) {
      try {
        const parsed = JSON.parse(editForm.requestBodyText);
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
    updateService.mutate(
      { 
        id: serviceId, 
        data: {
          name: editForm.name,
          url: editForm.url,
          maxResponseTime: Number(editForm.maxResponseTime),
           expectedStructure: editForm.expectedStructure,
           visibility: editForm.visibility,
           requestMethod: editForm.requestMethod,
           targetAuthType: editForm.targetAuthType,
           targetAuthHeaderName: editForm.targetAuthType === "API_KEY_HEADER"
             ? editForm.targetAuthHeaderName
             : null,
           ...(editForm.targetAuthSecret.trim()
             ? { targetAuthSecret: editForm.targetAuthSecret.trim() }
             : {}),
           requestBody,
        } 
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetServiceQueryKey(serviceId) });
          queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
          setIsEditing(false);
          toast({ title: "Gespeichert", description: "Dienstkonfiguration wurde aktualisiert." });
        },
        onError: (error) => {
          toast({ title: "Fehler", description: error.data?.error || "Konnte nicht gespeichert werden.", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Sheet open={!!serviceId} onOpenChange={(open) => {
      if (!open) {
        setIsEditing(false);
        onClose();
      }
    }}>
      <SheetContent className="w-full sm:max-w-xl md:max-w-2xl bg-card border-l-border/50 p-0 flex flex-col">
        {isLoading && (
          <div className="p-6 space-y-4">
            <div className="h-8 bg-muted rounded animate-pulse w-1/2" />
            <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
            <div className="h-40 bg-muted rounded animate-pulse w-full mt-8" />
          </div>
        )}
        
        {isError && (
          <div className="p-6">
            <p className="text-destructive">Fehler beim Laden der Dienstdetails.</p>
          </div>
        )}

        {service && (
          <>
            <SheetHeader className="p-6 pb-4 border-b border-border/50 bg-background/50">
              <div className="flex items-start justify-between">
                <div>
                  <SheetTitle className="text-2xl">{service.name}</SheetTitle>
                  <SheetDescription className="font-mono text-xs mt-1 text-primary">
                    {service.url}
                  </SheetDescription>
                  <Badge variant={service.visibility === "LISTED" ? "default" : "outline"} className="mt-3">
                    {service.visibility === "LISTED" ? "Öffentlich gelistet" : "Privat"}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Dienst wirklich löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Diese Aktion kann nicht rückgängig gemacht werden. Alle Prüfdaten für "{service.name}" werden dauerhaft entfernt.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Löschen</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" /> Trust Score
                  </p>
                  <p className="text-xl font-bold font-mono">
                    {service.trustScore !== null ? `${service.trustScore}%` : "—"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Activity className="h-3 w-3" /> Letzter Status
                  </p>
                  <div>
                    {service.checks[0] ? (
                      <Badge variant={service.checks[0].status === "PASS" ? "default" : service.checks[0].status === "FAIL" ? "destructive" : "secondary"}>
                        {checkStatusLabel(service.checks[0].status)}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">Nie</span>
                    )}
                  </div>
                </div>
                <div className="space-y-1 col-span-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <HelpCircle className="h-3 w-3" /> Begründung
                  </p>
                  <p className="text-sm font-medium line-clamp-2" title={service.trustExplanation}>
                    {service.trustExplanation}
                  </p>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto">
              <Tabs defaultValue="tests" className="w-full">
                <div className="px-6 border-b border-border/50 sticky top-0 bg-card z-10">
                  <TabsList className="bg-transparent h-12 w-full justify-start gap-6 rounded-none p-0">
                    <TabsTrigger value="tests" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-12">
                      Live-Prüfung & Historie
                    </TabsTrigger>
                    <TabsTrigger value="manual" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-12">
                      Manuelle Prüfung
                    </TabsTrigger>
                    <TabsTrigger value="config" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 h-12">
                      Konfiguration
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="tests" className="p-6 m-0 space-y-6">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Historische Trust-Signale</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <span>Uptime</span><strong>{service.trustMetrics.uptimePercent === null ? "Nicht bewertet" : `${service.trustMetrics.uptimePercent}%`}</strong>
                        <span>p95 / p99</span><strong>{service.trustMetrics.p95ResponseTimeMs ?? "—"} / {service.trustMetrics.p99ResponseTimeMs ?? "—"} ms</strong>
                        <span>Samples</span><strong>{service.trustMetrics.sampleCount}</strong>
                        <span>Domain</span><strong>{service.domainVerification.status}</strong>
                        <span>Regionale Daten</span><strong>{service.trustMetrics.regionalAggregation.state}</strong>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">{service.trustMetrics.weighting.description} {service.trustMetrics.regionalAggregation.description}</p>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Letzte Signalzustände</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <span>HTTPS</span><strong>{service.signals.https}</strong>
                        <span>TLS/Zertifikat</span><strong>{service.signals.tls}</strong>
                        <span>Security-Header</span><strong>{service.signals.securityHeaders}</strong>
                        <span>Freshness</span><strong>{service.trustMetrics.latestCheckAt ? "Vorhanden" : "Nicht bewertet"}</strong>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">Geprüft bedeutet nur: Bond402 hat dieses Signal bei einer Live-Prüfung beobachtet. Es ist keine Sicherheitsgarantie.</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h4 className="font-medium text-sm">Domain-Verifizierung</h4>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">Bestätigt, dass der Betreiber eine HTTPS-Well-Known-Datei unter der Service-Domain kontrolliert.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={handleIssueDomainVerification} disabled={issueDomainVerification.isPending}>Token erzeugen</Button>
                        <Button size="sm" onClick={handleCheckDomainVerification} disabled={checkDomainVerification.isPending || service.domainVerification.status === "NOT_STARTED"}>Jetzt prüfen</Button>
                      </div>
                    </div>
                    {domainToken && <p className="mt-3 break-all rounded-lg bg-background/70 p-3 font-mono text-xs">Token: {domainToken}</p>}
                  </div>
                  <div className="bg-muted/30 border border-border/50 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-sm">Jetzt prüfen</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {service.requestMethod === "POST"
                          ? "Sendet einen POST-Request an den Zielservice und gleicht die Antwort mit der Struktur ab."
                          : "Kontaktiert die URL direkt über unseren Server und gleicht die Antwort mit der Struktur ab."}
                      </p>
                      {service.requestMethod === "POST" && (
                        <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                          Achtung: POST kann Kosten verursachen oder Seiteneffekte auslösen.
                        </p>
                      )}
                    </div>
                    <AlertDialog open={postConfirmationOpen} onOpenChange={setPostConfirmationOpen}>
                      <Button onClick={handleRunLiveCheck} disabled={runCheck.isPending}>
                        {runCheck.isPending ? (
                          <Activity className="h-4 w-4 mr-2 animate-pulse" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Prüfung starten
                      </Button>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>POST-Prüfung ausdrücklich bestätigen</AlertDialogTitle>
                          <AlertDialogDescription>
                            Diese Prüfung sendet den konfigurierten POST-Body an „{service.name}“. Das kann Kosten verursachen oder eine Aktion beim Zielservice auslösen. Möchten Sie fortfahren?
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                          <AlertDialogAction onClick={startLiveCheck}>POST-Prüfung ausführen</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Clock className="h-4 w-4" /> Prüfhistorie
                    </h4>
                    {service.checks.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">Noch keine Prüfungen durchgeführt.</p>
                    ) : (
                      <div className="space-y-3">
                        {service.checks.map((check) => (
                          <div key={check.id} className="border border-border/50 bg-card rounded-lg p-3 text-sm">
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-center gap-2">
                                {check.status === "PASS" ? (
                                  <CheckCircle2 className="h-4 w-4 text-success" />
                                ) : check.status === "FAIL" ? (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                ) : (
                                  <ShieldAlert className="h-4 w-4 text-warning" />
                                )}
                                 <span className="font-semibold">{checkStatusLabel(check.status)}</span>
                                <span className="text-muted-foreground text-xs bg-muted px-2 py-0.5 rounded">
                                   {checkTypeLabel(check.checkType)}
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground font-mono">
                                {format(new Date(check.checkedAt), "dd.MM.yyyy HH:mm:ss", { locale: de })}
                              </span>
                            </div>
                            
                            <p className="text-muted-foreground mb-3">{check.summary}</p>
                            
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="flex justify-between bg-muted/30 p-2 rounded">
                                <span>Latenz:</span>
                                <span className="font-mono">{check.responseTimeMs}ms</span>
                              </div>
                              <div className="flex justify-between bg-muted/30 p-2 rounded">
                                <span>Erreichbar:</span>
                                <span>{check.reachable ? "Ja" : "Nein"}</span>
                              </div>
                              <div className="flex justify-between bg-muted/30 p-2 rounded">
                                <span>HTTP Code:</span>
                                <span className="font-mono">{check.httpStatus || "—"}</span>
                              </div>
                              <div className="flex justify-between bg-muted/30 p-2 rounded">
                                <span>Struktur:</span>
                                <span className={check.structureMatch ? "text-success" : "text-destructive"}>
                                  {check.structureMatch ? "Korrekt" : "Abweichend"}
                                </span>
                              </div>
                            </div>

                            {(!check.structureMatch && (check.missingFields.length > 0 || check.foundFields.length > 0)) && (
                              <div className="mt-3 text-xs bg-destructive/5 border border-destructive/20 rounded p-2">
                                {check.missingFields.length > 0 && (
                                  <div className="mb-1">
                                    <span className="font-semibold text-destructive">Fehlend:</span> {check.missingFields.join(", ")}
                                  </div>
                                )}
                                {check.foundFields.length > 0 && (
                                  <div>
                                    <span className="font-semibold text-muted-foreground">Gefunden:</span> {check.foundFields.join(", ")}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="manual" className="p-6 m-0 space-y-6">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-sm">JSON manuell prüfen</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Fügen Sie hier eine simulierte API-Antwort ein, um sie gegen die hinterlegte Struktur zu validieren. Dies kontaktiert die externe URL nicht.
                      </p>
                    </div>
                    <Textarea 
                      className="font-mono text-sm min-h-[200px]" 
                      placeholder="{'ihr': 'json'}"
                      value={manualResponse}
                      onChange={(e) => setManualResponse(e.target.value)}
                    />
                    <Button 
                      className="w-full" 
                      onClick={handleManualVerify}
                      disabled={verifyManual.isPending || !manualResponse.trim()}
                    >
                      {verifyManual.isPending ? "Prüft..." : "Validieren"}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="config" className="p-6 m-0 space-y-6">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h4 className="font-medium text-sm">Dienstkonfiguration</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Passen Sie die Überwachungsparameter an.
                      </p>
                    </div>
                    <Button 
                      variant={isEditing ? "default" : "outline"} 
                      size="sm" 
                      onClick={() => {
                        if (isEditing) {
                          handleUpdate();
                        } else {
                          setIsEditing(true);
                        }
                      }}
                      disabled={updateService.isPending}
                    >
                      {isEditing ? (
                        <>
                          <Save className="h-4 w-4 mr-2" />
                          Speichern
                        </>
                      ) : (
                        <>
                          <Pencil className="h-4 w-4 mr-2" />
                          Bearbeiten
                        </>
                      )}
                    </Button>
                  </div>

                  {isEditing ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input 
                          value={editForm.name} 
                          onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>URL</Label>
                        <Input 
                          value={editForm.url} 
                          onChange={(e) => setEditForm(f => ({ ...f, url: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Max. Antwortzeit (ms)</Label>
                        <Input 
                          type="number"
                          value={editForm.maxResponseTime} 
                          onChange={(e) => setEditForm(f => ({ ...f, maxResponseTime: Number(e.target.value) }))}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Prüfmethode</Label>
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={editForm.requestMethod}
                            onChange={(e) => setEditForm((f) => ({ ...f, requestMethod: e.target.value as "GET" | "POST" }))}
                          >
                            <option value="GET">GET – liest Daten</option>
                            <option value="POST">POST – kann Aktionen auslösen</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label>Zielauthentifizierung</Label>
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={editForm.targetAuthType}
                            onChange={(e) => setEditForm((f) => ({ ...f, targetAuthType: e.target.value as "NONE" | "BEARER" | "API_KEY_HEADER" }))}
                          >
                            <option value="NONE">Keine</option>
                            <option value="BEARER">Bearer-Token</option>
                            <option value="API_KEY_HEADER">API-Key im Header</option>
                          </select>
                        </div>
                      </div>
                      {editForm.targetAuthType === "API_KEY_HEADER" && (
                        <div className="space-y-2">
                          <Label>API-Key-Header</Label>
                          <Input
                            value={editForm.targetAuthHeaderName}
                            placeholder="X-API-Key"
                            onChange={(e) => setEditForm((f) => ({ ...f, targetAuthHeaderName: e.target.value }))}
                          />
                        </div>
                      )}
                      {editForm.targetAuthType !== "NONE" && (
                        <div className="space-y-2">
                          <Label>{editForm.targetAuthType === "BEARER" ? "Neues Bearer-Token" : "Neuer API-Key"}</Label>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            value={editForm.targetAuthSecret}
                            placeholder={service.targetAuthSecretConfigured ? "Leer lassen, um das bisherige Secret zu behalten" : "Secret eingeben"}
                            onChange={(e) => setEditForm((f) => ({ ...f, targetAuthSecret: e.target.value }))}
                          />
                          <p className="text-xs text-muted-foreground">Das bisherige Secret wird nie angezeigt. Leer lassen behält es unverändert.</p>
                        </div>
                      )}
                      {editForm.requestMethod === "POST" && (
                        <div className="space-y-2">
                          <Label>JSON-Request-Body (optional)</Label>
                          <Textarea
                            className="font-mono text-xs min-h-[150px]"
                            value={editForm.requestBodyText}
                            onChange={(e) => setEditForm((f) => ({ ...f, requestBodyText: e.target.value }))}
                          />
                          <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                            POST kann Kosten verursachen oder Seiteneffekte auslösen. Jede Live-Prüfung sendet diesen Body.
                          </p>
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>Erwartete Struktur (JSON)</Label>
                        <Textarea 
                          className="font-mono text-xs min-h-[150px]"
                          value={editForm.expectedStructure} 
                          onChange={(e) => setEditForm(f => ({ ...f, expectedStructure: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Sichtbarkeit</Label>
                        <select
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={editForm.visibility}
                          onChange={(e) => setEditForm((f) => ({ ...f, visibility: e.target.value as "PRIVATE" | "LISTED" }))}
                        >
                          <option value="PRIVATE">Privat – nicht im öffentlichen Katalog</option>
                          <option value="LISTED">Gelistet – öffentliche Trust-Daten</option>
                        </select>
                        <p className="text-xs leading-5 text-muted-foreground">
                          Gelistet bedeutet: Name, URL, Trust Score und gespeicherte Prüfmetadaten sind öffentlich. Besitzer- und Schlüsselangaben bleiben privat.
                        </p>
                      </div>
                      <div className="flex justify-end pt-2">
                        <Button variant="ghost" onClick={() => setIsEditing(false)}>
                          Abbrechen
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Live-Request</p>
                        <p className="text-sm bg-muted/30 p-2 rounded border border-border/50">
                          {service.requestMethod} · {service.targetAuthType === "NONE" ? "ohne Zielauthentifizierung" : service.targetAuthType === "BEARER" ? "Bearer-Token" : `API-Key (${service.targetAuthHeaderName ?? "Header"})`}
                          {service.targetAuthSecretConfigured ? " · Secret hinterlegt" : ""}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Sichtbarkeit</p>
                        <p className="text-sm bg-muted/30 p-2 rounded border border-border/50">
                          {service.visibility === "LISTED" ? "Öffentlich gelistet" : "Privat"}
                        </p>
                      </div>
                      {service.requestBody && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">JSON-Request-Body</p>
                          <pre className="font-mono text-xs bg-muted/30 p-4 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(service.requestBody, null, 2)}</pre>
                        </div>
                      )}
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">URL</p>
                        <p className="font-mono text-sm break-all bg-muted/30 p-2 rounded border border-border/50">{service.url}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Max. erlaubte Antwortzeit</p>
                        <p className="font-mono text-sm bg-muted/30 p-2 rounded border border-border/50">{service.maxResponseTime} ms</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Erwartete JSON-Struktur</p>
                        <pre className="font-mono text-xs bg-muted/30 p-4 rounded border border-border/50 overflow-x-auto whitespace-pre-wrap">
                          {(() => {
                            try {
                              return JSON.stringify(JSON.parse(service.expectedStructure), null, 2);
                            } catch {
                              return service.expectedStructure;
                            }
                          })()}
                        </pre>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
