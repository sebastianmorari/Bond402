import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Service, CheckResult, ServiceStatus } from '@/lib/store';
import { CheckCircle2, XCircle, AlertCircle, FileJson, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  service: Service;
  onComplete: (result: Omit<CheckResult, 'id' | 'timestamp'>) => void;
}

export function ManualVerification({ service, onComplete }: Props) {
  const [actualInput, setActualInput] = useState('');
  const [result, setResult] = useState<{
    status: ServiceStatus;
    found: string[];
    missing: string[];
    message: string;
  } | null>(null);

  const expectedFields = service.expectedStructure
    .split(',')
    .map(f => f.trim().toLowerCase())
    .filter(f => f.length > 0);

  const handleVerify = () => {
    if (!actualInput.trim()) {
      setResult({
        status: 'FAIL',
        found: [],
        missing: expectedFields,
        message: 'Keine Eingabe gefunden. Bitte fügen Sie die Serverantwort ein.'
      });
      return;
    }

    let extractedKeys: string[] = [];
    let isJson = false;

    // Try parsing as JSON
    try {
      const parsed = JSON.parse(actualInput);
      isJson = true;
      
      const extractKeysRecursive = (obj: any, prefix = ''): string[] => {
        let keys: string[] = [];
        if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
          for (const key in obj) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            keys.push(fullKey.toLowerCase());
            keys = keys.concat(extractKeysRecursive(obj[key], fullKey));
          }
        }
        return keys;
      };

      extractedKeys = extractKeysRecursive(parsed);
    } catch (e) {
      // Not JSON, just do simple string matching
      isJson = false;
    }

    const inputLower = actualInput.toLowerCase();
    
    const found: string[] = [];
    const missing: string[] = [];

    expectedFields.forEach(field => {
      // If it's JSON, we check if the exact key exists.
      // If it's just string text, we check if the string includes the field name.
      const isPresent = isJson 
        ? extractedKeys.some(k => k === field || k.endsWith(`.${field}`))
        : inputLower.includes(field);

      if (isPresent) {
        found.push(field);
      } else {
        missing.push(field);
      }
    });

    let status: ServiceStatus = 'PASS';
    let message = 'Alle erwarteten Felder wurden erfolgreich verifiziert.';

    if (found.length === 0) {
      status = 'FAIL';
      message = isJson 
        ? 'Die JSON-Daten enthalten keines der erwarteten Felder.'
        : 'Der Text enthält keines der erwarteten Felder. Ist das Format korrekt?';
    } else if (missing.length > 0) {
      // If more than half are missing, maybe fail? Let's just say REVIEW for any partial.
      if (missing.length > expectedFields.length / 2) {
         status = 'FAIL';
         message = 'Die meisten erwarteten Felder fehlen. Die Datenstruktur ist unvollständig.';
      } else {
         status = 'REVIEW';
         message = 'Einige Felder wurden gefunden, aber es fehlen Teile der Spezifikation.';
      }
    }

    setResult({ status, found, missing, message });

    // Save as check history
    onComplete({
      status,
      isManual: true,
      metrics: {
        reachability: true,
        responseTimeMs: 0,
        structureMatch: status === 'PASS',
        logs: [
          '--- Manuelle Prüfung ---',
          isJson ? 'Eingabe als JSON erkannt.' : 'Eingabe als Roh-Text erkannt.',
          `Gefundene Felder: ${found.length > 0 ? found.join(', ') : 'Keine'}`,
          `Fehlende Felder: ${missing.length > 0 ? missing.join(', ') : 'Keine'}`,
          `Ergebnis: ${message}`
        ]
      }
    });
  };

  return (
    <Card className="border-2 border-border/50 bg-card shadow-sm">
      <CardHeader className="bg-muted/20 border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-md">
            <FileJson className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Struktur manuell abgleichen</CardTitle>
            <CardDescription>
              Fügen Sie eine Beispiel-Antwort ein, um sie mit Ihren Vorgaben abzugleichen.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        <div className="space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium">Erwartete Struktur (aus Registrierung):</span>
            <Badge variant="outline" className="font-mono">{expectedFields.length} Felder</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {expectedFields.map(f => (
              <Badge key={f} variant="secondary" className="bg-muted text-muted-foreground font-mono">
                {f}
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">Tatsächliche Antwort (JSON oder Text):</label>
          <Textarea 
            value={actualInput}
            onChange={(e) => setActualInput(e.target.value)}
            placeholder="{\n  &quot;temperatur&quot;: 22.5,\n  &quot;wind&quot;: 12\n}"
            className="font-mono text-sm min-h-[150px] bg-muted/10"
          />
        </div>

        <Button onClick={handleVerify} className="w-full gap-2">
          <Play className="w-4 h-4" /> Daten abgleichen
        </Button>

        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="overflow-hidden"
            >
              <div className={`mt-4 p-4 rounded-xl border ${
                result.status === 'PASS' ? 'bg-success/10 border-success/30' :
                result.status === 'FAIL' ? 'bg-destructive/10 border-destructive/30' :
                'bg-warning/10 border-warning/30'
              }`}>
                <div className="flex items-start gap-3">
                  {result.status === 'PASS' && <CheckCircle2 className="w-6 h-6 text-success shrink-0" />}
                  {result.status === 'FAIL' && <XCircle className="w-6 h-6 text-destructive shrink-0" />}
                  {result.status === 'REVIEW' && <AlertCircle className="w-6 h-6 text-warning shrink-0" />}
                  <div className="space-y-2">
                    <h4 className={`font-semibold ${
                      result.status === 'PASS' ? 'text-success' :
                      result.status === 'FAIL' ? 'text-destructive' :
                      'text-warning'
                    }`}>
                      {result.status === 'PASS' ? 'Prüfung Bestanden' :
                       result.status === 'FAIL' ? 'Prüfung Fehlgeschlagen' :
                       'Teilweise Übereinstimmung'}
                    </h4>
                    <p className="text-sm opacity-90">{result.message}</p>
                    
                    <div className="pt-3 grid gap-2 sm:grid-cols-2 text-sm mt-2 border-t border-current/20">
                      <div>
                        <span className="font-semibold block mb-1">Gefunden:</span>
                        {result.found.length > 0 ? (
                          <ul className="list-disc list-inside pl-4 text-success opacity-80 font-mono text-xs">
                            {result.found.map(f => <li key={f}>{f}</li>)}
                          </ul>
                        ) : <span className="opacity-60 text-xs italic">- Keine -</span>}
                      </div>
                      <div>
                        <span className="font-semibold block mb-1">Fehlend:</span>
                        {result.missing.length > 0 ? (
                          <ul className="list-disc list-inside pl-4 text-destructive opacity-80 font-mono text-xs">
                            {result.missing.map(f => <li key={f}>{f}</li>)}
                          </ul>
                        ) : <span className="opacity-60 text-xs italic">- Keine -</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
