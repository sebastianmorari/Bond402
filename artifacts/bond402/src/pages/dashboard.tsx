import { useState } from 'react';
import { useServices, Service } from '@/lib/store';
import { RegisterServiceForm } from '@/components/register-service-form';
import { ServiceCard, StatusBadge } from '@/components/service-card';
import { SimulatedCheck } from '@/components/simulated-check';
import { ManualVerification } from '@/components/manual-verification';
import { TrustScoreIndicator } from '@/components/trust-score-indicator';
import { Roadmap } from '@/components/roadmap';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Plus, ArrowLeft, Info, Server, Activity, Clock, BarChart3, CheckCircle2, FileJson } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function Dashboard() {
  const { services, addService, addCheckResult, deleteService } = useServices();
  const [view, setView] = useState<'LIST' | 'REGISTER' | 'DETAILS'>('LIST');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const { toast } = useToast();

  const selectedService = services.find(s => s.id === selectedServiceId);

  const handleRegister = (serviceData: Omit<Service, 'id' | 'checks'>) => {
    const newService = addService(serviceData);
    setSelectedServiceId(newService.id);
    setView('DETAILS');
    toast({
      title: "Dienst registriert",
      description: "Ihr API-Dienst wurde erfolgreich hinzugefügt.",
    });
  };

  // Calculate Dashboard Stats
  const totalServices = services.length;
  const totalChecks = services.reduce((acc, s) => acc + s.checks.length, 0);
  const passedChecks = services.reduce((acc, s) => acc + s.checks.filter(c => c.status === 'PASS').length, 0);
  const globalPassRate = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
  
  let sumResponseTime = 0;
  let checksWithTime = 0;
  services.forEach(s => {
    s.checks.forEach(c => {
      if (c.metrics && c.metrics.responseTimeMs > 0) {
        sumResponseTime += c.metrics.responseTimeMs;
        checksWithTime++;
      }
    });
  });
  const avgResponseTime = checksWithTime > 0 ? Math.round(sumResponseTime / checksWithTime) : 0;

  const handleDocumentationClick = () => {
    toast({
      title: "Dokumentation",
      description: "Die API-Dokumentation befindet sich im Aufbau.",
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div 
            className="flex items-center gap-3 cursor-pointer" 
            onClick={() => setView('LIST')}
          >
            <div className="bg-primary text-primary-foreground p-1.5 rounded-md shadow-[0_0_15px_rgba(59,130,246,0.3)]">
              <Shield className="w-6 h-6" />
            </div>
            <span className="text-xl font-bold tracking-tight">Bond402</span>
          </div>
          <nav className="hidden md:flex gap-6 text-sm font-medium text-muted-foreground">
            <span 
              className={`cursor-pointer transition-colors ${view === 'LIST' ? 'text-foreground' : 'hover:text-foreground'}`}
              onClick={() => setView('LIST')}
            >
              Dashboard
            </span>
            <span 
              className="cursor-pointer transition-colors hover:text-foreground"
              onClick={handleDocumentationClick}
            >
              Dokumentation
            </span>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-12">
        {view === 'LIST' && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Intro Hero */}
            <section className="bg-card border border-border/50 rounded-2xl p-8 md:p-12 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-96 h-96 bg-success/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
              <div className="relative z-10 max-w-2xl space-y-6">
                <h1 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight">
                  Vertrauen ist gut.<br />
                  <span className="text-primary">Verifizierung ist besser.</span>
                </h1>
                <p className="text-lg text-muted-foreground">
                  Bond402 prüft maschinenlesbare API-Dienste fortlaufend. 
                  Wir stellen sicher, dass Sie genau das bekommen, wofür Sie bezahlen: schnelle, korrekte und zuverlässige Daten.
                </p>
                <div className="pt-4 flex gap-4">
                  <Button size="lg" onClick={() => setView('REGISTER')} className="font-semibold shadow-lg shadow-primary/20">
                    <Plus className="w-5 h-5 mr-2" />
                    Neuen Dienst überwachen
                  </Button>
                </div>
              </div>
            </section>

            {/* Dashboard Summary */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-card border border-border/50 rounded-xl p-5 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Server className="w-4 h-4" />
                  <span className="text-sm font-medium">Registrierte Dienste</span>
                </div>
                <div className="text-3xl font-bold font-mono">{totalServices}</div>
              </div>
              
              <div className="bg-card border border-border/50 rounded-xl p-5 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Activity className="w-4 h-4" />
                  <span className="text-sm font-medium">Gesamte Prüfungen</span>
                </div>
                <div className="text-3xl font-bold font-mono">{totalChecks}</div>
              </div>

              <div className="bg-card border border-border/50 rounded-xl p-5 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Erfolgsquote (PASS)</span>
                </div>
                <div className="text-3xl font-bold font-mono">
                  {globalPassRate}<span className="text-xl text-muted-foreground">%</span>
                </div>
              </div>

              <div className="bg-card border border-border/50 rounded-xl p-5 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm font-medium">Ø Antwortzeit</span>
                </div>
                <div className="text-3xl font-bold font-mono">
                  {avgResponseTime}<span className="text-xl text-muted-foreground">ms</span>
                </div>
              </div>
            </section>

            {/* Service List */}
            <section className="space-y-6">
              <div className="flex justify-between items-end">
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold tracking-tight">Ihre überwachten Dienste</h2>
                  <p className="text-muted-foreground">Aktueller Status aller verbundenen Schnittstellen.</p>
                </div>
              </div>

              {services.length === 0 ? (
                <div className="text-center py-24 bg-card/50 rounded-xl border border-dashed border-border/50">
                  <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-medium text-foreground mb-2">Noch keine Dienste registriert</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Fügen Sie Ihren ersten API-Dienst hinzu, um dessen Verfügbarkeit und Antwortstruktur automatisch zu überwachen.
                  </p>
                  <Button onClick={() => setView('REGISTER')}>Dienst registrieren</Button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {services.map(service => (
                    <ServiceCard 
                      key={service.id} 
                      service={service} 
                      onClick={(s) => {
                         setSelectedServiceId(s.id);
                         setView('DETAILS');
                         window.scrollTo(0, 0);
                      }} 
                    />
                  ))}
                </div>
              )}
            </section>

            <Roadmap />
          </div>
        )}

        {view === 'REGISTER' && (
          <div className="animate-in fade-in slide-in-from-right-8 duration-300">
            <Button variant="ghost" onClick={() => setView('LIST')} className="mb-8 -ml-4">
              <ArrowLeft className="w-4 h-4 mr-2" /> Zurück zur Übersicht
            </Button>
            <RegisterServiceForm 
              onRegister={handleRegister} 
              onCancel={() => setView('LIST')} 
            />
          </div>
        )}

        {view === 'DETAILS' && selectedService && (
          <div className="animate-in fade-in slide-in-from-right-8 duration-300 space-y-8">
            <Button variant="ghost" onClick={() => setView('LIST')} className="-ml-4 mb-2">
              <ArrowLeft className="w-4 h-4 mr-2" /> Zurück zur Übersicht
            </Button>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <h1 className="text-3xl font-bold tracking-tight mb-2">{selectedService.name}</h1>
                <div className="flex items-center gap-3 text-sm text-muted-foreground font-mono bg-muted/50 py-1.5 px-3 rounded-md border border-border/50">
                  <Server className="w-4 h-4 text-primary" />
                  {selectedService.url}
                </div>
              </div>
              <div className="flex gap-4 items-center">
                <TrustScoreIndicator service={selectedService} showDetails />
                <div className="w-px h-10 bg-border mx-2 hidden md:block"></div>
                <Button 
                  variant="outline" 
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive border-transparent"
                  onClick={() => {
                    if (confirm('Möchten Sie diesen Dienst wirklich entfernen?')) {
                      deleteService(selectedService.id);
                      setView('LIST');
                    }
                  }}
                >
                  Entfernen
                </Button>
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-8">
              {/* Left Column: Details & History */}
              <div className="lg:col-span-1 space-y-8">
                <div className="bg-card border border-border/50 rounded-xl p-6 space-y-6 shadow-sm">
                  <h3 className="font-semibold text-lg flex items-center gap-2 border-b border-border/50 pb-4">
                    <Info className="w-5 h-5 text-primary" /> Spezifikationen
                  </h3>
                  
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Erwartete Struktur</p>
                      <div className="font-mono text-sm bg-muted/30 p-3 rounded-md border border-border/50 break-words">
                        {selectedService.expectedStructure}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Maximale Antwortzeit</p>
                      <div className="font-medium flex items-center gap-2 bg-muted/30 p-3 rounded-md border border-border/50 font-mono">
                        <Clock className="w-4 h-4 text-primary" />
                        {selectedService.maxResponseTime} ms
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
                  <h3 className="font-semibold text-lg flex items-center gap-2 border-b border-border/50 pb-4 mb-4">
                    <BarChart3 className="w-5 h-5 text-primary" /> Prüfungsverlauf
                  </h3>
                  
                  {selectedService.checks.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">Noch keine Prüfungen durchgeführt.</p>
                  ) : (
                    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                      {selectedService.checks.map(check => (
                        <div key={check.id} className="flex flex-col gap-2 py-3 border-b border-border/50 last:border-0">
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={check.status} />
                              {check.isManual && (
                                <span className="text-[10px] uppercase tracking-wider bg-primary/20 text-primary px-1.5 py-0.5 rounded font-bold">Manuell</span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {format(check.timestamp, "dd. MMM, HH:mm", { locale: de })}
                            </span>
                          </div>
                          
                          {check.metrics && (
                            <div className="grid grid-cols-2 gap-2 mt-1 text-xs text-muted-foreground bg-muted/20 p-2 rounded">
                              <div className="flex items-center gap-1.5" title="Erreichbarkeit">
                                <Activity className="w-3.5 h-3.5 opacity-70" />
                                {check.metrics.reachability ? 'Online' : 'Offline'}
                              </div>
                              <div className="flex items-center gap-1.5" title="Antwortzeit">
                                <Clock className="w-3.5 h-3.5 opacity-70" />
                                <span className="font-mono">{check.metrics.responseTimeMs}ms</span>
                              </div>
                              <div className="col-span-2 flex items-center gap-1.5 mt-1 border-t border-border/30 pt-1" title="Struktur">
                                <FileJson className="w-3.5 h-3.5 opacity-70" />
                                {check.metrics.structureMatch ? 'Struktur korrekt' : 'Struktur fehlerhaft'}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Verification Tools */}
              <div className="lg:col-span-2">
                <Tabs defaultValue="simulation" className="w-full">
                  <TabsList className="w-full grid grid-cols-2 mb-6 h-auto p-1 bg-muted/50 border border-border/50">
                    <TabsTrigger value="simulation" className="py-2.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                      <Activity className="w-4 h-4 mr-2" /> Automatische Simulation
                    </TabsTrigger>
                    <TabsTrigger value="manual" className="py-2.5 data-[state=active]:bg-card data-[state=active]:shadow-sm">
                      <FileJson className="w-4 h-4 mr-2" /> Manuelle Überprüfung
                    </TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="simulation" className="mt-0 outline-none">
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 mb-6 flex gap-4">
                      <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-semibold text-primary mb-1">Simulierter Prüfablauf</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Starten Sie eine Simulation, um die Erreichbarkeit und das Antwortverhalten des Dienstes zu testen. 
                          Dieser Test sendet fiktive Anfragen und bewertet die Antwortzeit sowie die Einhaltung des erwarteten Formats.
                        </p>
                      </div>
                    </div>

                    <SimulatedCheck 
                      serviceName={selectedService.name}
                      url={selectedService.url}
                      maxTime={selectedService.maxResponseTime}
                      onComplete={(result) => addCheckResult(selectedService.id, result)}
                    />
                  </TabsContent>
                  
                  <TabsContent value="manual" className="mt-0 outline-none">
                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 mb-6 flex gap-4">
                      <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-semibold text-primary mb-1">Strukturabgleich</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Haben Sie eine Beispiel-Antwort des Servers erhalten? Fügen Sie den JSON-Code oder Text hier ein. 
                          Wir prüfen, ob alle geforderten Felder vorhanden sind.
                        </p>
                      </div>
                    </div>

                    <ManualVerification 
                      service={selectedService}
                      onComplete={(result) => addCheckResult(selectedService.id, result)}
                    />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
