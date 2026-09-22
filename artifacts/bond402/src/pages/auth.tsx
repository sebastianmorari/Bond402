import { FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, KeyRound, Shield, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { PublicFooter } from "@/components/public-footer";

export function AuthPage({ mode }: { mode: "signIn" | "signUp" }) {
  const [, setLocation] = useLocation();
  const { signIn, signUp } = useAuth();
  const isSignUp = mode === "signUp";
  const requestedReturnTo = new URLSearchParams(window.location.search).get("returnTo");
  const returnTo = requestedReturnTo && requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : null;
  const oauthAuthorization = (() => {
    if (!returnTo || !returnTo.startsWith("/oauth/authorize?")) return null;
    try {
      const parsed = new URL(returnTo, window.location.origin);
      const transaction = parsed.searchParams.get("transaction");
      return transaction ? { transaction } : null;
    } catch {
      return null;
    }
  })();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [developerKey, setDeveloperKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [developerKeyError, setDeveloperKeyError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeveloperKeySubmitting, setIsDeveloperKeySubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (isSignUp) {
        await signUp(name, email, password);
        setLocation(returnTo ? `/verify-email?returnTo=${encodeURIComponent(returnTo)}` : "/verify-email");
      } else {
        await signIn(email, password);
        if (returnTo?.startsWith("/oauth/authorize?")) {
          window.location.assign(returnTo);
        } else {
          setLocation(returnTo || "/dashboard");
        }
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Die Anmeldung ist fehlgeschlagen.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeveloperKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!oauthAuthorization) return;
    setDeveloperKeyError(null);
    setIsDeveloperKeySubmitting(true);
    try {
      const response = await fetch("/oauth/authorize/developer-key", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction: oauthAuthorization.transaction,
          developer_key: developerKey,
        }),
      });
      const body = await response.json().catch(() => null) as { continueTo?: string; error_description?: string };
      if (!response.ok || !body?.continueTo || !body.continueTo.startsWith("/oauth/authorize?")) {
        throw new Error(body?.error_description || "Der Developer-Key konnte nicht verifiziert werden.");
      }
      window.location.assign(body.continueTo);
    } catch (submitError) {
      setDeveloperKeyError(submitError instanceof Error ? submitError.message : "Die Developer-Key-Verifizierung ist fehlgeschlagen.");
    } finally {
      setIsDeveloperKeySubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8 text-foreground">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Shield className="h-5 w-5" />
            </span>
            <span className="text-left">
              <span className="block text-xl font-bold leading-tight">Bond402</span>
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Trust Infrastructure</span>
            </span>
          </Link>
        </div>

        <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl shadow-black/10 sm:p-8">
          <div className="mb-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {isSignUp ? <UserPlus className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
            </div>
            <h1 className="text-2xl font-bold">{isSignUp ? "Konto erstellen" : "Bei Bond402 anmelden"}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {isSignUp
                ? "Erstellen Sie ein kostenloses Konto. Ihre E-Mail-Adresse wird vor der ersten Anmeldung bestätigt."
                : "Melden Sie sich an, um Ihre Dienste und Developer-Schlüssel zu verwalten."}
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {isSignUp && (
              <div className="space-y-2">
                <Label htmlFor="auth-name">Name</Label>
                <Input id="auth-name" value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={80} autoComplete="name" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="auth-email">E-Mail-Adresse</Label>
              <Input id="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} autoComplete="email" />
            </div>
            {!isSignUp && (
              <div className="text-right text-sm">
                <Link href="/forgot-password" className="font-medium text-primary hover:underline">
                  Passwort vergessen?
                </Link>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="auth-password">Passwort</Label>
              <Input id="auth-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete={isSignUp ? "new-password" : "current-password"} />
              {isSignUp && <p className="text-xs text-muted-foreground">Mindestens 8 Zeichen.</p>}
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
              {isSubmitting ? "Wird verarbeitet …" : isSignUp ? "Kostenlos registrieren" : "Anmelden"}
              {!isSubmitting && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          {!isSignUp && oauthAuthorization && (
            <>
              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>oder</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <form className="space-y-3" onSubmit={handleDeveloperKey}>
                <div className="space-y-2">
                  <Label htmlFor="oauth-developer-key">Mit Developer-Key verifizieren</Label>
                  <Input
                    id="oauth-developer-key"
                    type="password"
                    value={developerKey}
                    onChange={(event) => setDeveloperKey(event.target.value)}
                    required
                    maxLength={512}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Der Key wird nur sicher an Bond402 gesendet und nicht an ChatGPT weitergegeben.
                  </p>
                </div>
                {developerKeyError && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {developerKeyError}
                  </div>
                )}
                <Button type="submit" variant="outline" className="w-full" disabled={isDeveloperKeySubmitting || !developerKey.trim()}>
                  {isDeveloperKeySubmitting ? "Wird verifiziert …" : "Developer-Key prüfen"}
                </Button>
              </form>
            </>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSignUp ? "Bereits ein Konto?" : "Noch kein Konto?"}{" "}
            <Link
              href={`${isSignUp ? "/sign-in" : "/sign-up"}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}
              className="font-medium text-primary hover:underline"
            >
              {isSignUp ? "Anmelden" : "Jetzt registrieren"}
            </Link>
          </p>
        </div>

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Bond402 sendet Bestätigungs- und Reset-Links über Resend. Die Links sind zeitlich begrenzt und nur einmal verwendbar.
        </p>
        <PublicFooter />
      </div>
    </div>
  );
}