import { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { 
  Terminal, Shield, ArrowLeft, Plus, Copy, CheckCircle2, AlertTriangle, Key, 
  Trash2, Clock, Calendar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListApiKeys, 
  useCreateApiKey, 
  useRevokeApiKey, 
  getListApiKeysQueryKey,
  useListServices
} from "@workspace/api-client-react";
import { X402Sandbox } from "@/components/x402-sandbox";
import { BondSandbox } from "@/components/bond-sandbox";
import { MobileNav } from "@/components/mobile-nav";
import { QuotaCard } from "@/components/quota-card";

export function Developer() {
  const { data: apiKeys = [], isLoading: isLoadingKeys, isError: isKeysError } = useListApiKeys();
  const { data: services = [], isError: isServicesError } = useListServices();
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newSecretData, setNewSecretData] = useState<{ secret: string, name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // React cache/deps stability gotchas
  const createMutateRef = useRef(createApiKey.mutate);
  createMutateRef.current = createApiKey.mutate;
  
  const revokeMutateRef = useRef(revokeApiKey.mutate);
  revokeMutateRef.current = revokeApiKey.mutate;

  const handleCreateKey = useCallback(() => {
    if (!newKeyName.trim()) {
      toast({ title: "Name erforderlich", description: "Bitte geben Sie einen Namen für den API-Schlüssel ein.", variant: "destructive" });
      return;
    }
    
    createMutateRef.current({ data: { name: newKeyName.trim() } }, {
      onSuccess: (data) => {
        setNewSecretData({ secret: data.secret, name: data.name });
        setNewKeyName("");
        setIsCreateOpen(false);
        queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
        toast({ title: "Schlüssel erstellt", description: "Der API-Schlüssel wurde erfolgreich generiert." });
      },
      onError: () => {
        toast({ title: "Fehler", description: "Der Schlüssel konnte nicht erstellt werden.", variant: "destructive" });
      }
    });
  }, [newKeyName, toast, queryClient]);

  const handleRevoke = useCallback((id: string) => {
    revokeMutateRef.current({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
        toast({ title: "Schlüssel widerrufen", description: "Der API-Schlüssel wurde erfolgreich deaktiviert." });
      },
      onError: () => {
        toast({ title: "Fehler", description: "Der Schlüssel konnte nicht widerrufen werden.", variant: "destructive" });
      }
    });
  }, [toast, queryClient]);

  const handleCopySecret = useCallback(() => {
    if (newSecretData) {
      navigator.clipboard.writeText(newSecretData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Kopiert", description: "API-Schlüssel in die Zwischenablage kopiert." });
    }
  }, [newSecretData, toast]);

  const activeServiceId = services.find(s => s.id)?.id || "<IHRE_SERVICE_ID>";
  const baseUrl = window.location.origin;

  return (
    <div className="mobile-content-safe min-h-[100dvh] bg-background text-foreground pb-28">
      <header className="border-b border-border/40 bg-card/30 sticky top-0 z-20 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">Bond402</h1>
            </div>
          </div>
          <Link href="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Zum Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight mb-2">Trust Firewall für AI Agents</h2>
          <p className="text-muted-foreground text-lg">
            Fragen Sie Bond402 vor jeder Nutzung eines externen Dienstes ab. Die unabhängige Risikoschicht liefert eine maschinenlesbare Entscheidung für Ihre Agenten.
          </p>
        </div>

        <section className="my-8">
          <QuotaCard />
        </section>

        {newSecretData && (
          <Card className="border-primary bg-primary/5 shadow-md shadow-primary/10">
            <CardHeader>
              <CardTitle className="text-primary flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Ihr neuer API-Schlüssel: {newSecretData.name}
              </CardTitle>
              <CardDescription className="text-foreground/80 font-medium text-sm">
                Kopieren Sie diesen Schlüssel sofort. Aus Sicherheitsgründen wird er nach dem Schließen dieser Meldung nie wieder vollständig angezeigt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 max-w-2xl">
                <Input 
                  readOnly 
                  value={newSecretData.secret} 
                  className="font-mono bg-background text-foreground tracking-wider font-semibold"
                />
                <Button 
                  onClick={handleCopySecret}
                  variant="secondary"
                  className="shrink-0"
                >
                  {copied ? <CheckCircle2 className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? "Kopiert" : "Kopieren"}
                </Button>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                onClick={() => {
                  setNewSecretData(null);
                  setCopied(false);
                  createApiKey.reset();
                }}
                className="w-full sm:w-auto mt-2"
              >
                Ich habe den Schlüssel sicher gespeichert
              </Button>
            </CardFooter>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <section className="space-y-6">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5 text-primary" />
                    API-Schlüssel
                  </CardTitle>
                  <CardDescription>Verwalten Sie Ihre aktiven Schlüssel.</CardDescription>
                </div>
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="w-full sm:w-auto">
                      <Plus className="h-4 w-4 mr-2" /> Neuer Schlüssel
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Neuen API-Schlüssel generieren</DialogTitle>
                      <DialogDescription>
                        Geben Sie dem Schlüssel einen Namen, um ihn später leichter zuordnen zu können (z.B. "GitHub Actions").
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Input 
                        placeholder="z.B. CI/CD Pipeline" 
                        value={newKeyName} 
                        onChange={(e) => setNewKeyName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCreateKey();
                          }
                        }}
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Abbrechen</Button>
                      <Button onClick={handleCreateKey} disabled={createApiKey.isPending}>
                        {createApiKey.isPending ? "Wird erstellt..." : "Generieren"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {isLoadingKeys ? (
                  <div className="flex justify-center py-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                ) : isKeysError ? (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-5 text-sm text-destructive">
                    API-Schlüssel konnten nicht geladen werden. Bitte versuchen Sie es später erneut.
                  </div>
                ) : apiKeys.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground border border-dashed border-border/60 rounded-xl bg-muted/10">
                    <Key className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium text-sm">Keine API-Schlüssel vorhanden</p>
                    <p className="text-xs opacity-70 mt-1">Generieren Sie Ihren ersten Schlüssel, um zu starten.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {apiKeys.map(key => (
                      <div key={key.id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border transition-colors ${key.revokedAt ? 'border-destructive/30 bg-destructive/5' : 'border-border/50 bg-muted/20 hover:bg-muted/40'}`}>
                        <div className="space-y-1 mb-4 sm:mb-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{key.name}</span>
                            {key.revokedAt ? (
                              <span className="text-[10px] uppercase tracking-wider bg-destructive/20 text-destructive px-2 py-0.5 rounded-full font-bold">Widerrufen</span>
                            ) : (
                              <span className="text-[10px] uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-full font-bold">Aktiv</span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono bg-background/50 inline-block px-2 py-0.5 rounded mt-1 border border-border/30">
                            {key.prefix}••••••••
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1.5">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 opacity-70" /> 
                              {format(new Date(key.createdAt), "dd.MM.yyyy", { locale: de })}
                            </span>
                            {key.lastUsedAt && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3 opacity-70" />
                                {format(new Date(key.lastUsedAt), "dd.MM.yyyy", { locale: de })}
                              </span>
                            )}
                          </div>
                        </div>
                        {!key.revokedAt && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Schlüssel wirklich widerrufen?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Möchten Sie den Schlüssel "{key.name}" endgültig widerrufen? Systeme, die diesen Schlüssel aktuell verwenden, verlieren sofort den Zugriff auf die API. Diese Aktion kann nicht rückgängig gemacht werden.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                <AlertDialogAction 
                                  onClick={() => handleRevoke(key.id)}
                                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                                >
                                  Widerrufen
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-primary" />
                  API-Dokumentation
                </CardTitle>
                <CardDescription>
                  Integrieren Sie Bond402-Prüfungen mit einfachen HTTP-Anfragen. Authentifizieren Sie sich über den Header <code className="text-xs bg-muted/50 px-1 py-0.5 rounded">Authorization: Bearer &lt;Schlüssel&gt;</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">Dienst maschinenlesbar abrufen</h3>
                  <p className="text-sm text-foreground/80">Liefert die Einstellungen, den Trust Score und – falls vorhanden – die letzte Prüfung Ihres Dienstes als JSON.</p>
                  <div className="relative">
                    <pre className="bg-muted/50 p-4 rounded-xl text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all border border-border/50">
                      <span className="text-primary font-bold">curl</span> {baseUrl}/api/developer/services/{activeServiceId} \
                      <br/>  -H <span className="text-green-600 dark:text-green-400">"Authorization: Bearer IHR_API_SCHLUESSEL"</span>
                    </pre>
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-tight text-primary">
                    <Shield className="h-4 w-4" />
                    Pre-Action-Check für AI Agents
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground/80">
                    Lassen Sie Ihren Agenten Bond402 unmittelbar vor einer externen Aktion fragen.
                    Die Antwort berücksichtigt aktuelle Erreichbarkeit, Antwortzeit, Strukturtreue,
                    PASS-/FAIL-Historie, Trust Score und Auffälligkeiten.
                  </p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl border border-border/50 bg-background/80 p-4 text-xs font-mono text-muted-foreground">
                    <span className="text-primary font-bold">curl</span> -X POST {baseUrl}/api/developer/services/{activeServiceId}/pre-action-check \
                    {"\n"}  -H <span className="text-green-600 dark:text-green-400">"Authorization: Bearer IHR_API_SCHLUESSEL"</span>
                  </pre>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Ergebnis: <code>ALLOW</code>, <code>CAUTION</code> oder <code>BLOCK</code> mit verständlichen Gründen und maschinenlesbaren Faktoren.
                    Jeder produktive Pre-Action-Check verbraucht ein Check aus dem Monatskontingent.
                  </p>
                </div>
                
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">Live-Prüfung starten</h3>
                  <p className="text-sm text-foreground/80">Bond402 ruft Ihren registrierten Dienst sicher auf, speichert das Ergebnis und berechnet den Trust Score neu.</p>
                  <div className="relative">
                    <pre className="bg-muted/50 p-4 rounded-xl text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all border border-border/50">
                      <span className="text-primary font-bold">curl</span> -X POST {baseUrl}/api/developer/services/{activeServiceId}/checks \
                      <br/>  -H <span className="text-green-600 dark:text-green-400">"Authorization: Bearer IHR_API_SCHLUESSEL"</span>
                    </pre>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">Letzte Prüfung abrufen</h3>
                  <p className="text-sm text-foreground/80">Liefert das zuletzt gespeicherte Prüfergebnis mit Erreichbarkeit, Antwortzeit, Strukturvergleich und Trust Score.</p>
                  <div className="relative">
                    <pre className="bg-muted/50 p-4 rounded-xl text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all border border-border/50">
                      <span className="text-primary font-bold">curl</span> {baseUrl}/api/developer/services/{activeServiceId}/checks/latest \
                      <br/>  -H <span className="text-green-600 dark:text-green-400">"Authorization: Bearer IHR_API_SCHLUESSEL"</span>
                    </pre>
                  </div>
                </div>

                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mt-6">
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-2 text-primary">
                    <Shield className="h-4 w-4" />
                    Wo finde ich meine Service-ID?
                  </h4>
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    {services.length > 0
                      ? <>Bond402 hat die ID Ihres ersten registrierten Dienstes bereits eingesetzt: <code className="bg-background px-1.5 py-0.5 rounded text-xs border border-border/30">{activeServiceId}</code>. Weitere IDs sehen Sie im Dashboard beim jeweiligen Dienst.</>
                      : <>Registrieren Sie zuerst einen Dienst im Dashboard. Danach setzt Bond402 dessen ID automatisch in diese Beispiele ein.</>}
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>

        <div className="space-y-8">
          {isServicesError && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
              Ihre Dienste konnten für die API-Beispiele nicht geladen werden.
            </div>
          )}
          <X402Sandbox services={services} />
          <BondSandbox services={services} />
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
