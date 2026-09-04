import { Link } from "wouter";
import { Shield, ArrowLeft, User, Mail, Calendar, LogOut, Terminal } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useAuth } from "@/lib/auth";

export function Profile() {
  const { user, isLoaded, signOut } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const primaryEmail = user.email;
  const createdAt = user.createdAt ? new Date(user.createdAt) : null;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pb-20">
      <header className="border-b border-border/40 bg-card/30 sticky top-0 z-20 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
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

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight">Konto & Profil</h2>
          <p className="text-muted-foreground mt-2">
            Verwalten Sie Ihre persönlichen Daten und den Zugang zu Bond402.
          </p>
        </div>

        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle>Persönliche Informationen</CardTitle>
            <CardDescription>
              Ihre bei Bond402 registrierten Daten.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-xl border border-border/50">
              <div className="h-16 w-16 bg-primary/20 rounded-full flex items-center justify-center text-primary border border-primary/30">
                  <User className="h-8 w-8" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">{user.name || "Unbenannt"}</h3>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                  <Mail className="h-3 w-3" /> {primaryEmail}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <User className="h-4 w-4" /> Name
                </p>
                <p className="font-medium bg-muted/30 p-3 rounded-lg border border-border/50">{user.name}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <User className="h-4 w-4" /> E-Mail-Adresse
                </p>
                <p className="font-medium bg-muted/30 p-3 rounded-lg border border-border/50">{user.email}</p>
              </div>
              {createdAt && (
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-4 w-4" /> Konto erstellt am
                  </p>
                  <p className="font-medium bg-muted/30 p-3 rounded-lg border border-border/50">
                    {format(createdAt, "dd. MMMM yyyy, HH:mm", { locale: de })} Uhr
                  </p>
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="bg-muted/10 border-t border-border/50 px-6 py-4">
            <Button 
              variant="destructive" 
              className="w-full sm:w-auto"
              onClick={() => signOut()}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Abmelden
            </Button>
          </CardFooter>
        </Card>

        <Card className="bg-card/50 border-border/50 mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              Entwickler-API
            </CardTitle>
            <CardDescription>
              Verwalten Sie Ihre API-Schlüssel für den programmatischen Zugriff auf Bond402.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Mit API-Schlüsseln können Sie die Zuverlässigkeitsprüfungen von Bond402 nahtlos in Ihre CI/CD-Pipelines oder eigenen Systeme integrieren.
            </p>
            <Link href="/developer" className={buttonVariants({ variant: "outline", className: "w-full sm:w-auto" })}>
              <Terminal className="h-4 w-4 mr-2" />
              API-Schlüssel verwalten
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
