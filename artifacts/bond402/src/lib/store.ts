import { useState, useEffect } from 'react';

export type ServiceStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'PENDING';

export interface CheckResult {
  id: string;
  timestamp: number;
  status: ServiceStatus;
  metrics: {
    reachability: boolean;
    responseTimeMs: number;
    structureMatch: boolean;
    logs: string[];
  };
  isManual?: boolean;
}

export interface Service {
  id: string;
  name: string;
  url: string;
  expectedStructure: string;
  maxResponseTime: number;
  checks: CheckResult[];
}

export interface TrustScoreDetails {
  score: number | null;
  reachabilityRate: number;
  performanceRate: number;
  structureRate: number;
  explanation: string;
}

export function calculateTrustScore(service: Service): TrustScoreDetails {
  if (!service.checks || service.checks.length === 0) {
    return {
      score: null,
      reachabilityRate: 0,
      performanceRate: 0,
      structureRate: 0,
      explanation: 'Keine Daten vorhanden. Führen Sie eine Prüfung durch, um den Trust Score zu ermitteln.'
    };
  }

  const total = service.checks.length;
  let reachableCount = 0;
  let performanceCount = 0;
  let structureCount = 0;

  service.checks.forEach(check => {
    // Robustness fallback
    const metrics = check.metrics || { reachability: false, responseTimeMs: 9999, structureMatch: false };
    
    if (metrics.reachability) reachableCount++;
    if (metrics.responseTimeMs <= service.maxResponseTime) performanceCount++;
    if (metrics.structureMatch) structureCount++;
  });

  const reachabilityRate = reachableCount / total;
  const performanceRate = performanceCount / total;
  const structureRate = structureCount / total;

  // Weights: Reachability 40%, Performance 30%, Structure 30%
  const score = Math.round((reachabilityRate * 40) + (performanceRate * 30) + (structureRate * 30));

  let explanation = '';
  if (score >= 90) {
    explanation = 'Ausgezeichnet. Der Dienst ist zuverlässig, schnell und liefert korrekte Daten.';
  } else if (score >= 70) {
    explanation = 'Gut, aber mit leichten Schwächen bei Antwortzeit oder Datenstruktur.';
  } else if (score >= 40) {
    explanation = 'Auffällig. Häufige Fehler, Ausfälle oder Verzögerungen festgestellt.';
  } else {
    explanation = 'Kritisch. Der Dienst ist unzuverlässig und sollte überprüft werden.';
  }

  return {
    score,
    reachabilityRate: Math.round(reachabilityRate * 100),
    performanceRate: Math.round(performanceRate * 100),
    structureRate: Math.round(structureRate * 100),
    explanation
  };
}

const INITIAL_SERVICES: Service[] = [
  {
    id: 's_test_1',
    name: 'Globale Wetter API',
    url: 'https://api.weather.test/v1/current',
    expectedStructure: 'temperatur, luftfeuchtigkeit, wind',
    maxResponseTime: 400,
    checks: [
      {
        id: 'c_test_1',
        timestamp: Date.now() - 3600000,
        status: 'PASS',
        metrics: {
          reachability: true,
          responseTimeMs: 124,
          structureMatch: true,
          logs: [
            '[INFO] Verbunden (12ms)',
            '[INFO] Antwort erhalten: 124ms',
            '[ERFOLG] Datenstruktur: Erwartete Felder gefunden',
          ],
        },
      },
    ],
  },
  {
    id: 's_test_2',
    name: 'Börsenkurse Live',
    url: 'https://api.finance.test/quotes',
    expectedStructure: 'preis, waehrung, zeitstempel',
    maxResponseTime: 200,
    checks: [
      {
        id: 'c_test_2',
        timestamp: Date.now() - 86400000,
        status: 'REVIEW',
        metrics: {
          reachability: true,
          responseTimeMs: 250,
          structureMatch: true,
          logs: [
            '[INFO] Verbunden (15ms)',
            '[WARNUNG] Antwort erhalten: 250ms (Überschreitet Ziel von 200ms)',
            '[ERFOLG] Datenstruktur: Erwartete Felder gefunden',
          ],
        },
      },
    ],
  },
];

export function useServices() {
  const [services, setServices] = useState<Service[]>(() => {
    try {
      const stored = localStorage.getItem('bond402_services');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Robustness migration: ensure checks exist and have metrics
        return parsed.map((s: any) => ({
          ...s,
          checks: (s.checks || []).map((c: any) => ({
            ...c,
            metrics: c.metrics || {
              reachability: c.status !== 'FAIL',
              responseTimeMs: s.maxResponseTime,
              structureMatch: c.status !== 'FAIL',
              logs: []
            }
          }))
        }));
      }
    } catch (e) {
      console.error('Failed to load services', e);
    }
    return INITIAL_SERVICES;
  });

  useEffect(() => {
    localStorage.setItem('bond402_services', JSON.stringify(services));
  }, [services]);

  const addService = (service: Omit<Service, 'id' | 'checks'>) => {
    const newService: Service = {
      ...service,
      id: `s_${Math.random().toString(36).substring(2, 9)}`,
      checks: [],
    };
    setServices((prev) => [newService, ...prev]);
    return newService;
  };

  const addCheckResult = (serviceId: string, result: Omit<CheckResult, 'id' | 'timestamp'>) => {
    setServices((prev) =>
      prev.map((s) => {
        if (s.id !== serviceId) return s;
        return {
          ...s,
          checks: [
            { ...result, id: `c_${Math.random().toString(36).substring(2, 9)}`, timestamp: Date.now() },
            ...s.checks,
          ],
        };
      })
    );
  };

  const deleteService = (serviceId: string) => {
    setServices((prev) => prev.filter((s) => s.id !== serviceId));
  };

  return { services, addService, addCheckResult, deleteService };
}
