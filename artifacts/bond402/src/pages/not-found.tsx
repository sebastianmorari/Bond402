import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { PublicFooter } from '@/components/public-footer';

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background">
      <Card className="mx-4 w-full max-w-md">
        <CardContent className="pt-6">
          <div className="mb-4 flex gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">Seite nicht gefunden</h1>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Die angeforderte Bond402-Seite existiert nicht.
          </p>
        </CardContent>
      </Card>
      <div className="mt-8 w-full">
        <PublicFooter />
      </div>
    </div>
  );
}
