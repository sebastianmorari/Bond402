import { useState, useEffect } from 'react';
import { CheckResult, ServiceStatus } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertCircle, Loader2, Play, Terminal, Info, ChevronRight, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  serviceName: string;
  url: string;
  maxTime: number;
  onComplete: (result: Omit<CheckResult, 'id' | 'timestamp'>) => void;
}

interface LogEntry {
  text: string;
  level: 'info' | 'success' | 'warn' | 'error';
}

export function SimulatedCheck({ serviceName, url, maxTime, onComplete }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [finalStatus, setFinalStatus] = useState<ServiceStatus | null>(null);

  const startCheck = () => {
    setIsRunning(true);
    setStep(0);
    setLogs([]);
    setFinalStatus(null);
  };

  useEffect(() => {
    if (!isRunning) return;

    let currentLogs: LogEntry[] = [];
    const addLog = (text: string, level: LogEntry['level'] = 'info') => {
      currentLogs = [...currentLogs, { text, level }];
      setLogs(currentLogs);
    };

    const runSimulation = async () => {
      // Step 1: Reachability
      setStep(1);
      addLog(`Initiere Verbindung zu ${url}...`, 'info');
      await new Promise(r => setTimeout(r, 800));
      
      const isReachable = Math.random() > 0.05; // 95% chance to be reachable
      if (!isReachable) {
        addLog('[FEHLER] Ziel nicht erreichbar (Connection Timeout).', 'error');
        setFinalStatus('FAIL');
        setIsRunning(false);
        onComplete({
          status: 'FAIL',
          metrics: { reachability: false, responseTimeMs: 0, structureMatch: false, logs: currentLogs.map(l => l.text) }
        });
        return;
      }
      addLog('[ERFOLG] Verbindung hergestellt.', 'success');
      
      // Step 2: Response Time
      setStep(2);
      addLog('Sende Test-Anfrage...', 'info');
      await new Promise(r => setTimeout(r, 1000));
      
      // Simulate a random response time around the maxTime
      const actualTime = Math.floor(Math.random() * maxTime * 1.5) + 20; 
      const isFastEnough = actualTime <= maxTime;
      
      if (isFastEnough) {
        addLog(`[ERFOLG] Antwort erhalten in ${actualTime}ms (Ziel: ${maxTime}ms).`, 'success');
      } else {
        addLog(`[WARNUNG] Antwort erhalten in ${actualTime}ms (Ziel ${maxTime}ms überschritten).`, 'warn');
      }

      // Step 3: Structure Match
      setStep(3);
      addLog('Analysiere Antwortstruktur (Simulation)...', 'info');
      await new Promise(r => setTimeout(r, 1200));

      const structureOk = Math.random() > 0.1; // 90% chance structure is correct
      if (structureOk) {
        addLog('[ERFOLG] Datenstruktur entspricht den Erwartungen.', 'success');
      } else {
        addLog('[FEHLER] Unerwartetes Datenformat. Fehlende Felder simuliert.', 'error');
      }

      // Final determination
      await new Promise(r => setTimeout(r, 500));
      
      let status: ServiceStatus = 'PASS';
      if (!structureOk) status = 'FAIL';
      else if (!isFastEnough) status = 'REVIEW';

      setFinalStatus(status);
      addLog(`[INFO] Prüfung abgeschlossen. Status: ${status}`, 'info');
      setIsRunning(false);
      onComplete({
        status,
        metrics: {
          reachability: true,
          responseTimeMs: actualTime,
          structureMatch: structureOk,
          logs: currentLogs.map(l => l.text)
        }
      });
    };

    runSimulation();
  }, [isRunning, url, maxTime, onComplete]);

  return (
    <Card className="border-2 border-border/50 overflow-hidden shadow-sm">
      <CardHeader className="bg-card border-b border-border/50 flex flex-row items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg font-mono font-medium tracking-tight">Simulations-Terminal</CardTitle>
        </div>
        {!isRunning && finalStatus === null && (
          <Button size="sm" onClick={startCheck} className="gap-2 font-mono bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20">
            <Play className="w-4 h-4" /> Start
          </Button>
        )}
      </CardHeader>
      
      <CardContent className="p-0">
        <div className="bg-[#0a0a0a] text-[#e5e5e5] p-6 font-mono text-sm min-h-[350px] flex flex-col relative">
          
          <div className="absolute top-4 right-4 flex items-center gap-2 text-xs text-muted-foreground bg-white/5 px-2 py-1 rounded border border-white/10">
            <Activity className="w-3 h-3" /> Simulationsmodus
          </div>

          <div className="flex-1 space-y-3 z-10 pt-4">
            {logs.length === 0 && !isRunning && (
              <p className="text-muted-foreground/50 italic">Bereit für automatischen Test von '{serviceName}'.</p>
            )}
            
            <AnimatePresence>
              {logs.map((log, i) => {
                let colorClass = 'text-gray-300';
                let Icon = ChevronRight;
                
                if (log.level === 'error') { colorClass = 'text-red-400'; Icon = XCircle; }
                else if (log.level === 'warn') { colorClass = 'text-yellow-400'; Icon = AlertCircle; }
                else if (log.level === 'success') { colorClass = 'text-emerald-400'; Icon = CheckCircle2; }
                else if (log.level === 'info') { colorClass = 'text-blue-300'; Icon = Info; }

                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex items-start gap-3 ${colorClass}`}
                  >
                    <Icon className="w-4 h-4 mt-0.5 opacity-70 shrink-0" />
                    <span className="leading-tight">{log.text}</span>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {isRunning && (
              <div className="flex items-center gap-3 text-blue-300/70 mt-6 border-t border-white/10 pt-4 w-max">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="animate-pulse">Führe Simulation aus...</span>
              </div>
            )}
          </div>
          
          <AnimatePresence>
            {finalStatus && !isRunning && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 pt-6 border-t border-white/10 z-10"
              >
                <div className={`p-4 rounded-lg flex items-center justify-between border ${
                  finalStatus === 'PASS' ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400' :
                  finalStatus === 'FAIL' ? 'bg-red-950/30 border-red-500/30 text-red-400' :
                  'bg-yellow-950/30 border-yellow-500/30 text-yellow-400'
                }`}>
                  <div className="flex items-center gap-4">
                    {finalStatus === 'PASS' && <CheckCircle2 className="w-8 h-8" />}
                    {finalStatus === 'FAIL' && <XCircle className="w-8 h-8" />}
                    {finalStatus === 'REVIEW' && <AlertCircle className="w-8 h-8" />}
                    <div>
                      <h4 className="font-bold text-base tracking-wide">
                        {finalStatus === 'PASS' ? 'SIMULATION ERFOLGREICH' :
                         finalStatus === 'FAIL' ? 'SIMULATION FEHLGESCHLAGEN' :
                         'ÜBERPRÜFUNG ERFORDERLICH'}
                      </h4>
                      <p className="text-xs opacity-80 mt-1">
                        {finalStatus === 'PASS' ? 'Der Dienst erfüllt alle Vorgaben in der Simulation.' :
                         finalStatus === 'FAIL' ? 'Der Dienst ist ausgefallen oder liefert falsche Daten.' :
                         'Der Dienst ist erreichbar, weist aber Abweichungen bei der Antwortzeit auf.'}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={startCheck} className="bg-black/50 border-current hover:bg-white/10 ml-4 shrink-0">
                    Erneut simulieren
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}
