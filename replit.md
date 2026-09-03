# Bond402

Bond402 ist eine leicht verständliche Vertrauens- und Prüfplattform für maschinenlesbare API-Dienste.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/bond402/` — die lauffähige Web-App
- `artifacts/bond402/src/pages/dashboard.tsx` — Startseite, Kennzahlen und Dienstansichten
- `artifacts/bond402/src/components/` — Dashboard, Registrierung, Live-Prüfung und Ergebnisansichten
- `artifacts/api-server/src/lib/api-verifier.ts` — geschützte externe Abrufe und Strukturvergleich
- `artifacts/api-server/src/routes/services.ts` — Dienste, Prüfungen, Historie, Kennzahlen und Demo-Dienste
- `lib/db/src/schema/bond402.ts` — dauerhafte Speicherung der Dienste und Prüfergebnisse
- `artifacts/bond402/src/index.css` — Farben, Schriften und visuelle Grundregeln
- `artifacts/api-server/` — vorbereiteter gemeinsamer API-Server für spätere echte Backend-Funktionen

## Architecture decisions

- Live-Prüfungen laufen serverseitig und dürfen nur öffentliche HTTP-/HTTPS-Ziele aufrufen; private Netze und interne Adressen werden blockiert.
- Registrierte Dienste und Prüfverläufe werden dauerhaft in PostgreSQL gespeichert; ein Benutzerkonto ist noch nicht erforderlich.
- Der Trust Score wird transparent aus echten Messwerten für Erreichbarkeit, Antwortzeit, Strukturtreue und bisherigen PASS-Ergebnissen berechnet.
- Zahlungen, USDC, Bonds, Blockchain, Reputation und Token sind nur als spätere Ausbaustufen vorgesehen.

## Product

- API-Dienste mit Name, URL, erwarteter Antwortstruktur und maximaler Antwortzeit registrieren
- Echte, geschützte Prüfungen starten und Ergebnisse als PASS, FAIL oder REVIEW verstehen
- Trust Score, Erreichbarkeit, Antwortzeit und Strukturtreue pro Dienst ansehen
- Erwartete und tatsächliche Ergebnisse manuell vergleichen
- Prüfverlauf und zusammengefasste Dashboard-Kennzahlen ansehen

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
