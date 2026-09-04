import { useState, useEffect } from "react";
import { 
  useGetService, 
  useDeleteService, 
  useUpdateService,
  useRunServiceCheck, 
  useVerifyServiceResponse,
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

interface ServiceDetailsProps {
  serviceId: string | null;
  onClose: () => void;
}

export function ServiceDetails({ serviceId, onClose }: ServiceDetailsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [manualResponse, setManualResponse] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    url: "",
    maxResponseTime: 1000,
    expectedStructure: ""
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
        expectedStructure: service.expectedStructure
      });
    }
  }, [service, isEditing]);

  const runCheck = useRunServiceCheck();
  const verifyManual = useVerifyServiceResponse();
  const deleteService = useDeleteService();
  const updateService = useUpdateService();

  const handleRunLiveCheck = () => {
    if (!serviceId) return;
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
    updateService.mutate(
      { 
        id: serviceId, 
        data: {
          name: editForm.name,
          url: editForm.url,
          maxResponseTime: Number(editForm.maxResponseTime),
          expectedStructure: editForm.expectedStructure
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
                        {service.checks[0].status}
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
                  <div className="bg-muted/30 border border-border/50 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <h4 className="font-medium text-sm">Jetzt prüfen</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Kontaktiert die URL direkt über unseren Server und gleicht die Antwort mit der Struktur ab.
                      </p>
                    </div>
                    <Button onClick={handleRunLiveCheck} disabled={runCheck.isPending}>
                      {runCheck.isPending ? (
                        <Activity className="h-4 w-4 mr-2 animate-pulse" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      Prüfung starten
                    </Button>
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
                                <span className="font-semibold">{check.status}</span>
                                <span className="text-muted-foreground text-xs bg-muted px-2 py-0.5 rounded">
                                  {check.checkType}
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
                      <div className="space-y-2">
                        <Label>Erwartete Struktur (JSON)</Label>
                        <Textarea 
                          className="font-mono text-xs min-h-[150px]"
                          value={editForm.expectedStructure} 
                          onChange={(e) => setEditForm(f => ({ ...f, expectedStructure: e.target.value }))}
                        />
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
