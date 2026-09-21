import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Copy,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListApiKeysQueryKey,
  useCreateApiKey,
  useListApiKeys,
  useRevokeApiKey,
} from "@workspace/api-client-react";
import type { ApiKey } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ApiScope = "read" | "plan" | "execute" | "audit";

interface McpAccessPanelProps {
  /** Die für MCP-Clients sichtbare same-origin-Adresse, zum Beispiel `/mcp`. */
  mcpEndpoint: string;
}

interface ScopeOption {
  id: ApiScope;
  label: string;
  detail: string;
  tone: string;
}

const scopeOptions: ScopeOption[] = [
  {
    id: "read",
    label: "Read",
    detail: "Search services and read trust details.",
    tone: "border-sky-400/20 bg-sky-400/[0.06]",
  },
  {
    id: "plan",
    label: "Plan",
    detail: "Build a decision-ready plan without a provider call.",
    tone: "border-violet-400/20 bg-violet-400/[0.06]",
  },
  {
    id: "execute",
    label: "Execute",
    detail: "Run an approved plan against verified owner-bound services.",
    tone: "border-amber-400/20 bg-amber-400/[0.06]",
  },
  {
    id: "audit",
    label: "Audit",
    detail: "Read owner-bound execution and decision status.",
    tone: "border-emerald-400/20 bg-emerald-400/[0.06]",
  },
];

const defaultScopes: ApiScope[] = ["read", "plan"];

function formatDate(value: string | null) {
  if (!value) return "Never used";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function safeScopes(key: ApiKey): ApiScope[] {
  const scopes = (key as ApiKey & { scopes?: unknown }).scopes;
  if (!Array.isArray(scopes)) return [];
  return scopes.filter(
    (scope): scope is ApiScope =>
      scope === "read" ||
      scope === "plan" ||
      scope === "execute" ||
      scope === "audit",
  );
}

function ScopePill({ scope }: { scope: ApiScope }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/[0.08] px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-primary"
      data-testid={`scope-pill-${scope}`}
    >
      <span className="h-1 w-1 rounded-full bg-primary" aria-hidden="true" />
      {scope}
    </span>
  );
}

export function McpAccessPanel({ mcpEndpoint }: McpAccessPanelProps) {
  const queryClient = useQueryClient();
  const apiKeysQuery = useListApiKeys();
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();
  const apiKeys = apiKeysQuery.data ?? [];

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(defaultScopes);
  const [formError, setFormError] = useState("");
  const [newSecret, setNewSecret] = useState<{ name: string; secret: string } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [secretAcknowledged, setSecretAcknowledged] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const resetCreateForm = () => {
    setName("");
    setScopes(defaultScopes);
    setFormError("");
  };

  const toggleScope = (scope: ApiScope, checked: boolean | "indeterminate") => {
    setScopes((current) =>
      checked === true
        ? [...new Set([...current, scope])]
        : current.filter((item) => item !== scope),
    );
  };

  const handleCreate = () => {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setFormError("Geben Sie einen Namen mit mindestens 2 Zeichen ein.");
      return;
    }
    if (scopes.length === 0) {
      setFormError("Wählen Sie mindestens einen Scope aus.");
      return;
    }

    setFormError("");
    createApiKey.mutate(
      { data: { name: trimmedName, scopes } },
      {
        onSuccess: (created) => {
          setNewSecret({ name: created.name, secret: created.secret });
          setSecretCopied(false);
          setSecretAcknowledged(false);
          resetCreateForm();
          setIsCreateOpen(false);
          void queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
        },
        onError: (error) => {
          const message = (error as { data?: { error?: string } }).data?.error;
          setFormError(message || "Der Zugang konnte nicht erstellt werden. Prüfen Sie Ihre Sitzung.");
        },
      },
    );
  };

  const handleRevoke = (key: ApiKey) => {
    setRevokingId(key.id);
    revokeApiKey.mutate(
      { id: key.id },
      {
        onSuccess: () => {
          setRevokingId(null);
          void queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
        },
        onError: () => setRevokingId(null),
      },
    );
  };

  const handleCopySecret = async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret.secret);
      setSecretCopied(true);
    } catch {
      setSecretCopied(false);
    }
  };

  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-[0_18px_70px_-38px_hsl(var(--primary)/0.45)]" aria-labelledby="mcp-access-title">
      <div className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-primary/[0.08] blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-32 w-72 bg-emerald-400/[0.04] blur-3xl" aria-hidden="true" />

      <div className="relative border-b border-border/60 px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.07] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Developer-Zugang
            </div>
            <h2 id="mcp-access-title" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Agent &amp; MCP Access
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              Geben Sie einem Agenten nur die benötigten Fähigkeiten. Bond402 verwendet für MCP und direkte API-Aufrufe dasselbe begrenzte Developer-API-Key-Modell.
            </p>
          </div>

          <Dialog
            open={isCreateOpen}
            onOpenChange={(open) => {
              setIsCreateOpen(open);
              if (!open) resetCreateForm();
            }}
          >
            <Button
              type="button"
              className="w-full gap-2 sm:w-auto"
              onClick={() => setIsCreateOpen(true)}
              data-testid="button-create-mcp-access"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Scoped-Zugang erstellen
            </Button>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Scoped-Agent-Zugang erstellen</DialogTitle>
                <DialogDescription>
                   Benennen Sie den Zugang nach dem Agenten, Workflow oder der Umgebung. Das Secret wird nach der Erstellung nur einmal angezeigt.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 py-2">
                <div className="space-y-2">
                  <label htmlFor="mcp-access-name" className="text-sm font-medium">
                    Zugangsname
                  </label>
                  <Input
                    id="mcp-access-name"
                    value={name}
                    maxLength={80}
                    placeholder="z. B. Support-Agent"
                    onChange={(event) => setName(event.target.value)}
                    data-testid="input-mcp-access-name"
                  />
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Berechtigungen</legend>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Beginnen Sie mit möglichst wenigen Berechtigungen. Für einzelne Workflows können Sie getrennte Zugänge erstellen.
                  </p>
                  <div className="grid gap-2">
                    {scopeOptions.map((option) => (
                      <label
                        key={option.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 ${option.tone}`}
                        data-testid={`label-scope-${option.id}`}
                      >
                        <Checkbox
                          checked={scopes.includes(option.id)}
                          onCheckedChange={(checked) => toggleScope(option.id, checked)}
                          aria-label={`${option.label} erlauben`}
                          data-testid={`checkbox-scope-${option.id}`}
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {option.label}
                            <code className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                              {option.id}
                            </code>
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.detail}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {formError && (
                  <p className="flex items-center gap-2 text-sm text-destructive" role="alert" data-testid="error-mcp-access-form">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {formError}
                  </p>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel-mcp-access">
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleCreate}
                  disabled={createApiKey.isPending}
                  className="gap-2"
                  data-testid="button-submit-mcp-access"
                >
                  {createApiKey.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Creating…
                    </>
                  ) : (
                    <>
                      Create access
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative grid gap-5 border-b border-border/60 p-5 sm:p-8 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-border/60 bg-background/35 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="h-4 w-4 text-primary" aria-hidden="true" />
              MCP endpoint
            </CardTitle>
            <CardDescription>
              Connect an MCP client to this same-origin route. It uses the scoped access created above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-muted/35 p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground sm:text-sm" data-testid="text-mcp-endpoint">
                {mcpEndpoint}
              </code>
              <span className="shrink-0 rounded border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                same-origin
              </span>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              No provider credentials are exposed to the client. Authenticate with a secret from a scoped Developer API key.
            </p>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-primary/[0.045] shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">How an agent should think</CardTitle>
            <CardDescription>Keep every external action behind an observable decision.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-3 sm:grid-cols-4 lg:grid-cols-2">
              {[
                ["01", "Search", "Find candidate services."],
                ["02", "Decide", "Read trust and policy signals."],
                ["03", "Plan", "Prepare without a provider call."],
                ["04", "Execute", "Run only when the policy allows it."],
              ].map(([number, title, detail]) => (
                <li key={title} className="flex gap-3" data-testid={`step-agent-${title.toLowerCase()}`}>
                  <span className="font-mono text-[10px] font-bold text-primary/80">{number}</span>
                  <span className="min-w-0">
                    <strong className="block text-sm font-medium">{title}</strong>
                    <span className="block text-xs leading-5 text-muted-foreground">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-4 border-t border-primary/15 pt-4 text-xs leading-5 text-muted-foreground">
              Execute stays limited to verified owner-bound services, even when an access key includes the execute scope.
            </p>
          </CardContent>
        </Card>
      </div>

      {newSecret && (
        <div className="relative border-b border-amber-400/20 bg-amber-400/[0.06] p-5 sm:p-8" role="status" aria-live="polite" data-testid="panel-new-mcp-secret">
          <div className="flex gap-3">
            <div className="mt-0.5 rounded-lg border border-amber-300/20 bg-amber-300/[0.1] p-2 text-amber-200">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h3 className="font-semibold text-amber-100">Secret created for {newSecret.name}</h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-200/70">shown once</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-amber-100/75">
                Store this secret in your agent runtime now. Bond402 will not display it again after acknowledgement.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Input
                  readOnly
                  value={newSecret.secret}
                  aria-label="New API secret"
                  className="min-w-0 border-amber-300/20 bg-background/70 font-mono text-xs text-foreground"
                  data-testid="input-new-mcp-secret"
                />
                <Button type="button" variant="secondary" onClick={handleCopySecret} className="shrink-0 gap-2" data-testid="button-copy-mcp-secret">
                  {secretCopied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  {secretCopied ? "Copied" : "Copy secret"}
                </Button>
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-amber-100/85">
                <Checkbox
                  checked={secretAcknowledged}
                  onCheckedChange={(checked) => setSecretAcknowledged(checked === true)}
                  aria-label="Acknowledge that the secret has been stored"
                  data-testid="checkbox-acknowledge-mcp-secret"
                />
                <span>I have stored this secret securely and understand it will not be shown again.</span>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!secretAcknowledged}
                onClick={() => {
                  setNewSecret(null);
                  setSecretCopied(false);
                  setSecretAcknowledged(false);
                }}
                className="mt-4 border-amber-300/25 bg-transparent text-amber-100 hover:bg-amber-300/10 hover:text-amber-50"
                data-testid="button-dismiss-mcp-secret"
              >
                Continue to access list
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="relative p-5 sm:p-8">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Scoped access</h3>
            <p className="mt-1 text-sm text-muted-foreground">Metadata only. Full secrets are never returned by the list.</p>
          </div>
          {!apiKeysQuery.isLoading && !apiKeysQuery.isError && (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground" data-testid="text-mcp-access-count">
              {apiKeys.length} {apiKeys.length === 1 ? "entry" : "entries"}
            </span>
          )}
        </div>

        {apiKeysQuery.isLoading && (
          <div className="space-y-3" aria-label="Loading scoped access" data-testid="loading-mcp-access">
            {[1, 2].map((item) => (
              <div key={item} className="h-28 animate-pulse rounded-xl border border-border/50 bg-muted/20" />
            ))}
          </div>
        )}

        {apiKeysQuery.isError && (
          <Alert variant="destructive" data-testid="error-mcp-access-list">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Access list unavailable</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>We could not load your scoped Developer API keys.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void apiKeysQuery.refetch()} data-testid="button-retry-mcp-access">
                <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!apiKeysQuery.isLoading && !apiKeysQuery.isError && apiKeys.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/[0.12] px-5 py-10 text-center" data-testid="empty-mcp-access">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.07] text-primary">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <h4 className="font-medium">No scoped access yet</h4>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
              Create a named access for an agent or workflow. Start with read and plan, then add execute only when needed.
            </p>
            <Button type="button" variant="outline" className="mt-5 gap-2" onClick={() => setIsCreateOpen(true)} data-testid="button-create-first-mcp-access">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create first access
            </Button>
          </div>
        )}

        {!apiKeysQuery.isLoading && !apiKeysQuery.isError && apiKeys.length > 0 && (
          <div className="grid gap-3" data-testid="list-mcp-access">
            {apiKeys.map((key) => {
              const isRevoked = Boolean(key.revokedAt);
              const isRevoking = revokingId === key.id;
              return (
                <div
                  key={key.id}
                  className={`rounded-xl border p-4 transition-colors sm:p-5 ${isRevoked ? "border-border/50 bg-muted/[0.12] opacity-75" : "border-border/70 bg-background/35 hover:border-primary/25"}`}
                  data-testid={`card-mcp-access-${key.id}`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="truncate font-semibold" data-testid={`text-mcp-access-name-${key.id}`}>{key.name}</h4>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${isRevoked ? "border-destructive/20 bg-destructive/[0.07] text-destructive" : "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300"}`}
                          data-testid={`status-mcp-access-${key.id}`}
                        >
                          {isRevoked ? <X className="h-3 w-3" aria-hidden="true" /> : <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                          {isRevoked ? "Revoked" : "Active"}
                        </span>
                      </div>
                      <div className="mt-2 flex min-w-0 items-center gap-2">
                        <Clipboard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <code className="truncate font-mono text-xs text-muted-foreground" data-testid={`text-mcp-access-prefix-${key.id}`}>
                          {key.prefix}••••••••
                        </code>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                         {safeScopes(key).length > 0 ? (
                           safeScopes(key).map((scope) => <ScopePill key={scope} scope={scope} />)
                         ) : (
                           <span className="text-xs text-muted-foreground">No active scopes</span>
                         )}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5" data-testid={`text-mcp-access-created-${key.id}`}>
                          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                          Created {formatDate(key.createdAt)}
                        </span>
                        <span className="flex items-center gap-1.5" data-testid={`text-mcp-access-last-used-${key.id}`}>
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          Last used {formatDate(key.lastUsedAt)}
                        </span>
                      </div>
                    </div>

                    {!isRevoked && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="w-full gap-2 text-muted-foreground hover:bg-destructive/[0.08] hover:text-destructive sm:w-auto"
                            disabled={isRevoking}
                            data-testid={`button-revoke-mcp-access-${key.id}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                            {isRevoking ? "Revoking…" : "Revoke"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke {key.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This immediately blocks requests using the masked key {key.prefix}. The action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel data-testid={`button-cancel-revoke-${key.id}`}>Keep access</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRevoke(key)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid={`button-confirm-revoke-${key.id}`}
                            >
                              Revoke access
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default McpAccessPanel;