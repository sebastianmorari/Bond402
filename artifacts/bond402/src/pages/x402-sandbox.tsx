import { useEffect } from "react";
import { ArrowLeft, Shield } from "lucide-react";
import { Link } from "wouter";
import { useListServices } from "@workspace/api-client-react";
import { X402Sandbox } from "@/components/x402-sandbox";
import { MobileNav } from "@/components/mobile-nav";

const X402_DONE_KEY = "bond402:onboarding:x402";

export function X402SandboxPage() {
  const { data: services = [] } = useListServices();

  useEffect(() => {
    window.localStorage.setItem(X402_DONE_KEY, "done");
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pb-28">
      <header className="sticky top-0 z-20 border-b border-border/40 bg-card/30 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight">Bond402</h1>
              <p className="text-[10px] font-semibold uppercase leading-none tracking-widest text-muted-foreground">
                Trust Infrastructure
              </p>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Zum Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-6 max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight">x402-Sandbox</h2>
          <p className="mt-2 text-lg text-muted-foreground">
            Erleben Sie den simulierten x402-Ablauf ohne echte Zahlungen, Wallets oder Blockchain-Transaktionen.
          </p>
        </div>
        <X402Sandbox services={services} />
      </main>

      <MobileNav />
    </div>
  );
}