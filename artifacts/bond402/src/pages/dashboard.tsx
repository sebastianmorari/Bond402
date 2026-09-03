import { useState } from "react";
import { DashboardMetrics } from "@/components/dashboard-metrics";
import { DemoServices } from "@/components/demo-services";
import { ServiceRegistration } from "@/components/service-registration";
import { ServiceList } from "@/components/service-list";
import { ServiceDetails } from "@/components/service-details";
import { Shield } from "lucide-react";

export default function Dashboard() {
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pb-20">
      <header className="border-b border-border/40 bg-card/30 sticky top-0 z-20 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
          <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight tracking-tight">Bond402</h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold leading-none">Trust Infrastructure</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Intro Section */}
        <section className="max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight mb-2">Zuverlässigkeitsprüfung für API-Dienste</h2>
          <p className="text-muted-foreground text-lg">
            Diese Plattform überwacht die Erreichbarkeit und Datenstruktur Ihrer Schnittstellen. 
            Maschinenlesbare Dienste benötigen Vertrauen – wir machen es messbar und dauerhaft nachweisbar.
          </p>
        </section>

        {/* Metrics */}
        <section>
          <DashboardMetrics />
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
            <DemoServices />
            <ServiceRegistration />
          </section>

        </div>
      </main>

      <ServiceDetails 
        serviceId={selectedServiceId} 
        onClose={() => setSelectedServiceId(null)} 
      />
    </div>
  );
}
