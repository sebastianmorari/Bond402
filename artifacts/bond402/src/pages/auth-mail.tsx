import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Mail, Shield, TriangleAlert } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PublicFooter } from "@/components/public-footer";

async function postAuthMail(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (!response.ok) throw new Error(data?.error || "Die Anfrage konnte nicht abgeschlossen werden.");
  return data;
}

function AuthMailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background px-4 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div className="mb-8 text-center">
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
        {children}
      </div>
      <div className="mx-auto w-full max-w-md">
        <PublicFooter />
      </div>
    </div>
  );
}

function Feedback({ error, success }: { error: string | null; success: string | null }) {
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (success) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{success}</span>
      </div>
    );
  }
  return null;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const data = await postAuthMail("/api/auth/password/forgot", { email });
      setSuccess(data?.message || "Wenn ein passendes Konto existiert, wurde eine E-Mail versendet.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Die Anfrage konnte nicht abgeschlossen werden.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthMailLayout>
      <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl shadow-black/10 sm:p-8">
        <div className="mb-6">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><KeyRound className="h-5 w-5" /></div>
          <h1 className="text-2xl font-bold">Passwort vergessen?</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Geben Sie Ihre E-Mail-Adresse ein. Aus Sicherheitsgründen erhalten alle Anfragen dieselbe Antwort.
          </p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="forgot-email">E-Mail-Adresse</Label>
            <Input id="forgot-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} autoComplete="email" />
          </div>
          <Feedback error={error} success={success} />
          <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
            {isSubmitting ? "Wird gesendet …" : "Reset-Link anfordern"}
            {!isSubmitting && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/sign-in" className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><ArrowLeft className="h-4 w-4" /> Zur Anmeldung</Link>
        </p>
      </div>
    </AuthMailLayout>
  );
}

export function VerifyEmailPage() {
  const [location, setLocation] = useLocation();
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token"), [location]);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    postAuthMail("/api/auth/verify-email", { token })
      .then((data) => {
        if (!cancelled) setSuccess(data?.message || "Ihre E-Mail-Adresse wurde bestätigt.");
      })
      .catch((verifyError) => {
        if (!cancelled) setError(verifyError instanceof Error ? verifyError.message : "Der Bestätigungslink ist ungültig.");
      })
      .finally(() => {
        if (!cancelled) setIsSubmitting(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);
    try {
      const data = await postAuthMail("/api/auth/resend-verification", { email });
      setSuccess(data?.message || "Wenn ein passendes Konto existiert, wurde eine E-Mail versendet.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Die Anfrage konnte nicht abgeschlossen werden.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthMailLayout>
      <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl shadow-black/10 sm:p-8">
        <div className="mb-6">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Mail className="h-5 w-5" /></div>
          <h1 className="text-2xl font-bold">{token ? "E-Mail-Adresse bestätigen" : "Bestätigungs-E-Mail erneut senden"}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {token ? "Der Link ist 24 Stunden gültig und kann nur einmal verwendet werden." : "Fordern Sie einen neuen Bestätigungslink an."}
          </p>
        </div>
        {token ? (
          <div className="space-y-4">
            {isSubmitting && <p className="text-sm text-muted-foreground">Der Link wird geprüft …</p>}
            <Feedback error={error} success={success} />
            {success && <Button className="w-full" onClick={() => setLocation("/sign-in")}>Zur Anmeldung</Button>}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleResend}>
            <div className="space-y-2">
              <Label htmlFor="verify-email">E-Mail-Adresse</Label>
              <Input id="verify-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={320} autoComplete="email" />
            </div>
            <Feedback error={error} success={success} />
            <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Wird gesendet …" : "Link anfordern"}</Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/sign-in" className="font-medium text-primary hover:underline">Zur Anmeldung</Link>
        </p>
      </div>
    </AuthMailLayout>
  );
}

export function ResetPasswordPage() {
  const [location, setLocation] = useLocation();
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token") || "", [location]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "Dieser Reset-Link enthält keinen gültigen Token.");
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Die neuen Passwörter stimmen nicht überein.");
      return;
    }
    setIsSubmitting(true);
    try {
      await postAuthMail("/api/auth/password/reset", { token, newPassword: password });
      setSuccess("Ihr Passwort wurde geändert. Alle bisherigen Sessions wurden beendet.");
      setPassword("");
      setConfirmPassword("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Das Passwort konnte nicht geändert werden.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthMailLayout>
      <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl shadow-black/10 sm:p-8">
        <div className="mb-6">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><KeyRound className="h-5 w-5" /></div>
          <h1 className="text-2xl font-bold">Neues Passwort setzen</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Der Reset-Link ist 30 Minuten gültig und kann nur einmal verwendet werden.</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="reset-password">Neues Passwort</Label>
            <Input id="reset-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-password-confirm">Passwort wiederholen</Label>
            <Input id="reset-password-confirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
          </div>
          <Feedback error={error} success={success} />
          {success ? <Button type="button" className="w-full" onClick={() => setLocation("/sign-in")}>Zur Anmeldung</Button> : <Button type="submit" className="w-full" disabled={isSubmitting || !token}>{isSubmitting ? "Wird geändert …" : "Passwort speichern"}</Button>}
        </form>
      </div>
    </AuthMailLayout>
  );
}