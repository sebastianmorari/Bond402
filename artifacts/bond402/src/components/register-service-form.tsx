import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Service } from '@/lib/store';
import { ShieldAlert, Info, Server, Clock, FileJson, Link2 } from 'lucide-react';

interface Props {
  onRegister: (service: Omit<Service, 'id' | 'checks'>) => void;
  onCancel: () => void;
}

export function RegisterServiceForm({ onRegister, onCancel }: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [expectedStructure, setExpectedStructure] = useState('');
  const [maxResponseTime, setMaxResponseTime] = useState(500);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Bitte geben Sie einen Namen ein.');
    if (!url.trim() || !url.startsWith('http')) return setError('Bitte geben Sie eine gültige URL ein (http:// oder https://).');
    if (!expectedStructure.trim()) return setError('Bitte geben Sie die erwarteten Daten an.');
    if (maxResponseTime < 1) return setError('Die Antwortzeit muss größer als 0 sein.');

    onRegister({
      name,
      url,
      expectedStructure,
      maxResponseTime,
    });
  };

  return (
    <Card className="w-full max-w-2xl mx-auto border-2 border-border/50 shadow-xl bg-card">
      <CardHeader className="bg-muted/30 pb-8 border-b border-border/50">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <Server className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl">Dienst registrieren</CardTitle>
        </div>
        <CardDescription className="text-base">
          Hinterlegen Sie die Eckdaten der Schnittstelle. Bond402 wird sie anhand dieser Vorgaben prüfen.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-8 pt-8">
          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/30 text-destructive rounded-lg flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            <Label htmlFor="name" className="text-base flex items-center gap-2">
              Anzeigename
            </Label>
            <Input
              id="name"
              placeholder="z.B. Globale Wetter API"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-12 text-lg bg-muted/20"
            />
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Ein leicht verständlicher Name für Ihr Dashboard.
            </p>
          </div>

          <div className="space-y-3">
            <Label htmlFor="url" className="text-base flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" /> Endpunkt-URL
            </Label>
            <Input
              id="url"
              placeholder="https://api.beispiel.de/daten"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-12 text-lg font-mono text-sm bg-muted/20"
            />
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Die genaue Internetadresse, an die Maschinen ihre Anfragen senden.
            </p>
          </div>

          <div className="space-y-3">
            <Label htmlFor="structure" className="text-base flex items-center gap-2">
              <FileJson className="w-4 h-4 text-primary" /> Erwartete Felder (Struktur)
            </Label>
            <Textarea
              id="structure"
              placeholder="z.B. temperatur, windgeschwindigkeit, datum"
              value={expectedStructure}
              onChange={(e) => setExpectedStructure(e.target.value)}
              className="min-h-[100px] text-lg font-mono text-sm bg-muted/20"
            />
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Durch Komma getrennte Schlüsselwörter. Wir prüfen, ob diese geliefert werden.
            </p>
          </div>

          <div className="space-y-3">
            <Label htmlFor="time" className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Maximale Antwortzeit (ms)
            </Label>
            <div className="flex items-center gap-3">
              <Input
                id="time"
                type="number"
                min="1"
                value={maxResponseTime}
                onChange={(e) => setMaxResponseTime(parseInt(e.target.value) || 0)}
                className="h-12 text-lg w-48 font-mono bg-muted/20"
              />
              <span className="text-muted-foreground font-medium">Millisekunden</span>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> 1000 Millisekunden entsprechen einer Sekunde. Schneller ist besser.
            </p>
          </div>
        </CardContent>
        <CardFooter className="bg-muted/30 pt-6 border-t border-border/50 flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel} className="bg-transparent">
            Abbrechen
          </Button>
          <Button type="submit" size="lg" className="shadow-lg shadow-primary/20">
            Dienst registrieren
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
