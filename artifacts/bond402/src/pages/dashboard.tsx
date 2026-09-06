import { useState } from "react";
import { DashboardMetrics } from "@/components/dashboard-metrics";
import { DemoServices } from "@/components/demo-services";
import { ServiceRegistration } from "@/components/service-registration";
import { ServiceList } from "@/components/service-list";
import { ServiceDetails } from "@/components/service-details";
import { Shield, User, LogOut, Terminal } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { GuidedOnboarding } from "@/components/guided-onboarding";
import { MobileNav } from "@/components/mobile-nav";
import { QuotaCard } from "@/components/quota-card";

export default function Dashboard() {
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const { user, signOut } = useAuth();

  return (
    <div className="mobile-content-safe min-h-[100dvh] bg-background text-foreground pb-28">
      <header className="border-b border-border/40 bg-card/30 sticky top-0 z-20 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">Bond402</h1>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold leading-none">Trust Infrastructure</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/developer" className="text-sm font-medium text-muted-foreground hover:text-foreground hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors border border-transparent hover:bg-card/50 hover:border-border/50">
              <Terminal className="h-4 w-4" />
              <span>API-Zugang</span>
            </Link>
            {user && (
              <Link href="/profile" className="flex items-center gap-2 hover:bg-card/50 px-3 py-1.5 rounded-full transition-colors border border-transparent hover:border-border/50">
                <div className="h-6 w-6 rounded-full overflow-hidden bg-primary/20">
                  <div className="h-full w-full flex items-center justify-center">
                    <User className="h-3 w-3 text-primary" />
                  </div>
                </div>
                <span className="text-sm font-medium hidden sm:block">
                  {user.name || "Profil"}
                </span>
              </Link>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-muted-foreground hover:text-foreground"
               onClick={() => signOut()}
              title="Abmelden"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        
        {/* Intro Section */}
        <section className="max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight mb-2">Trust Firewall for AI Agents</h2>
          <p className="text-muted-foreground text-lg">
            Bond402 verbindet Service-Discovery, Trust-Metadaten und Live-Checks mit einer
            maschinenlesbaren Entscheidung vor jeder externen Agentenaktion.
            Prüfen Sie einen Dienst, bevor ein Agent ihn verwendet.
          </p>
        </section>

        <section className="mb-8">
          <GuidedOnboarding />
        </section>

        {/* Metrics */}
        <section>
          <DashboardMetrics />
        </section>

        <section className="my-8">
          <QuotaCard />
        </section>

        {/* Main Content Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Registered Services */}
          <section className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold tracking-tight">Ihre registrierten Dienste</h3>
            </div>
            <ServiceList onSelectService={setSelectedServiceId} />
          </section>

          {/* Right Column: Actions (Demo & Register) */}
          <section className="space-y-6">
            <DemoServices readOnly={false} />
            <div id="service-registration" className="scroll-mt-24">
              <ServiceRegistration />
            </div>
          </section>

        </div>
      </main>

      <ServiceDetails 
        serviceId={selectedServiceId} 
        onClose={() => setSelectedServiceId(null)} 
      />
      <MobileNav />
    </div>
  );
}
