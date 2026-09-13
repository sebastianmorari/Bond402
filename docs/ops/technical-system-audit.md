# Technischer System-Audit

## Geltungsbereich und Nachweisstatus

Dieser Audit beschreibt den lokalen Arbeitsstand nach dem erfolgreichen
`pnpm run test:launch-gate`-Lauf. `origin/main` und Produktion wurden dadurch
nicht verändert und nicht als verifiziert behandelt. Der lokale Stand ist die
Quelle für die Implementierungsbewertung; ein Produktionsstand ist nur dann
nachgewiesen, wenn ein echter externer Smoke-Test vorliegt. In diesem Auftrag
wurde kein Deployment ausgeführt.

## Architektur

- **Implementiert:** PNPM-Workspace mit React/Vite-Web-App, Express-API,
  PostgreSQL/Drizzle-Datenmodell, gemeinsamem OpenAPI-Vertrag und generierten
  Zod-/React-Clienttypen. Frontend und API sind getrennte Artefakte; die API
  bindet an `PORT`.
- **Teilweise:** `vercel.json` beschreibt Frontend-Build und API-Rewrites zu
  einem Render-Ziel. Replit-Autoscale ist zusätzlich konfiguriert. Welche
  Deployment-Konfiguration tatsächlich verwendet wird, ist lokal lesbar, aber
  nicht durch einen Produktionsrequest bestätigt.
- **Fehlt/Risiko:** Keine nachgewiesene Multi-Region-Ausführung, keine durable
  Job-Queue und kein externer Observability-Stack. API, Datenbank und Rewrite-
  Pfad sind damit betriebliche Single Points of Failure.
- **Tests/Annahmen:** Workspace-Typecheck, Build, Frontend-Smoke und
  Service-Routentests prüfen die lokalen Verträge. Die Annahme ist, dass
  Proxy, `PORT`, `DATABASE_URL` und Produktionsmigrationen außerhalb dieses
  Repositories korrekt bereitgestellt werden.

## Frontend und UX

- **Implementiert:** Authentifizierte Bereiche, Dashboard, interne Suche,
  öffentliche Suche, externe Discovery-Detailseite, Importformular,
  Service-Detail/Historie, Statusseite, Legal-/Trust-Seiten und mobile
  Navigation. Lade-, Fehler- und leere Zustände sind an den zentralen Flows
  vorhanden.
- **Verbessert:** Externe Treffer öffnen nicht mehr die Quell- oder
  Spezifikations-URL als Importziel. Import ist nur möglich, wenn ein sicherer
  GET/HEAD-Endpunkt oder ein eindeutig deklarierter HTTPS-Server abgeleitet
  wurde. Nicht-JSON-Gatewayfehler werden als kontrollierte Fehlermeldung
  dargestellt. Die Statusseite bricht hängende Health-/Readiness-Anfragen nach
  fünf Sekunden ab.
- **Teilweise:** Es gibt keinen echten Browser-E2E-Lauf für Login → Dashboard →
  Suche → Import → Prüfung und keinen automatisierten Mobile-Viewport-Test.
  Historie und Detail-Sheets sind weiterhin ungepaginiert.
- **Tests:** Frontend-Smoke, Frontend-SEO, Service-UI, Registrierungs-Payload
  sowie API-Integrationssuiten. Der lokale Gate-Lauf ersetzt keinen Browser-
  und keinen externen Produktionslauf.

## Backend, Authentifizierung und Sessions

- **Implementiert:** Express-API mit Zod-Grenzen, Request-ID-Korrelation,
  kontrolliertem Fehlerhandler, serverseitiger Registrierung, E-Mail-
  Verifizierung, Passwort-Reset, scrypt-Passwort-Hashes und httpOnly-
  Session-Cookies. Auth-Mail-Tokens werden gehasht gespeichert und atomar
  verbraucht.
- **Teilweise:** Resend ist serverseitig vorbereitet; benötigte Secrets und
  `PUBLIC_BASE_URL` sind Umgebungsanforderungen. Ein echter Provider-, DNS-,
  Absender- oder HTTPS-Link-Smoke wurde nicht ausgeführt.
- **Risiken:** Initiale Sessionfehler werden absichtlich anonym behandelt
  (fail-open für die UI); das kann bei einem API-Ausfall zu einem sichtbaren
  Login-Wechsel führen. In-Memory-Limits sind bei mehreren API-Instanzen nicht
  global.
- **Tests:** Auth-Session, Public-MVP-Auth-Mail-/Reset-Fälle,
  Service-Routen, Protected API und DB-Resilienz. Produktions-Mail ist nicht
  verifiziert.

## Datenbankmodell und Migrationen

- **Implementiert:** PostgreSQL über Drizzle mit Tabellen für Konten,
  Sessions, Dienste, Checks, API-Schlüssel, Rate-Limits, Security
  Observations und Threat-Indikatoren. Security-Observations referenzieren
  den Dienst mit Cascade-Delete. Check-Historien werden begrenzt geladen.
- **Teilweise:** Additive Schema-Kompatibilität und fehlende Security-Tabellen
  wurden lokal behoben. `db push` ist laut Projektdokumentation nur für
  Entwicklung vorgesehen; ein versionierter Produktions-Restore oder
  Produktionsschema-Abgleich wurde nicht durchgeführt.
- **Verbessert:** Check, Observation, Threat-Indikatoren, History-Limit und
  First-Seen-Status werden in einer gemeinsamen DB-Transaktion gespeichert.
  Observations und Threat-Indikatoren haben weiterhin keine dokumentierte
  Aufbewahrungsbereinigung.
- **Tests:** Public-catalog-schema, Service-Safety, DB-Resilienz,
  Service-Routen, Public-MVP und der isolierte Dump/Restore-Test mit
  temporärer Quell- und Zieldatenbank. Ein Produktionsrestore ist offen.

## Ownership und Authorization

- **Implementiert:** Private Services, Updates, Löschungen, Live-Checks,
  manuelle Checks, Domain-Verifikation und Developer-Funktionen werden
  serverseitig owner-bound gefiltert. Fremde IDs liefern keinen privaten
  Datensatz.
- **Teilweise:** Direkte HTTP-Ownershiptests sind vorhanden; zwei getrennte
  Browser-Sessions und UI-Reaktionen bei Sessionablauf sind nicht als
  Browser-E2E abgedeckt.
- **Tests:** Service-Routen, Public-MVP, Protected API und Service-Safety.
- **Risiko:** Ein POST-Live-Check bleibt für den berechtigten Besitzer eine
  potenziell mutierende Zielaktion; die UI-Warnung ist keine zusätzliche
  serverseitige fachliche Freigabe.

## API-Discovery und Suchlogik

- **Implementiert:** Der interne, operator-gelistete Katalog ist der
  Primärpfad. APIs.guru ist nur eine unverifizierte, begrenzte externe
  Metadatenquelle. Ranking nutzt Textrelevanz und beobachtbare interne bzw.
  externe Evidenz; kalte externe Discovery blockiert den internen Katalog
  nicht mehr.
- **Teilweise:** Externe Detailseiten lesen Spezifikationen passiv, wählen
  nur sichere parameterfreie GET/HEAD-Kandidaten und bieten einen nicht
  authentifizierten HEAD-Preflight. Ein externer Treffer ist kein Trust-
  Datensatz und kein Produktionsnachweis.
- **Risiken:** Externe Quelle, DNS, Spezifikationsformat und Zielserver
  können ausfallen oder widersprüchlich sein. Discovery ist kein
  Reputations- oder Threat-Intelligence-Dienst.
- **Tests:** Public-external-discovery, Public-external-detail,
  Public-external-routes, Public-service-search, Public-MVP und
  Katalog-Schema. Library-, Katalog- und kontrollierte Routenverträge sind im
  lokalen Gate enthalten; ein Browser-E2E gegen eine reale Umgebung fehlt.

## Sandbox, First-Seen und Quarantäne

- **Implementiert:** Neue Dienste starten mit `SANDBOX_PENDING`. Trust-Scores
  sind bei wenigen Samples begrenzt; externe öffentliche Checks werden nicht
  persistiert. Verdächtige oder historisch veränderte Beobachtungen begrenzen
  Confidence und Pre-Action-Entscheidungen.
- **Verbessert:** `VERIFIED_LOW_RISK` zählt jetzt nur erreichbare erfolgreiche
  2xx-Live-Beobachtungen mit vorhandenen Security-Signalen, ohne Threat-
  Indikator, historischen Drift oder Security-Confidence-Fehler. Timeouts
  oder reine HTTP-Fehler können nicht mehr zur Promotion beitragen.
- **Teilweise:** Die Quarantäne ist primär Status-, Score- und Pre-Action-
  Policy; es gibt keine separate, dauerhaft laufende Sandbox-Infrastruktur
  oder Mehrregionen-Überwachung. „Verified low risk“ bleibt eine lokale
  Beobachtungsstufe und keine Sicherheitszertifizierung.
- **Tests:** Trust-Score-Regressionen, Pre-Action, Trust-Metrics,
  Security-Signals und Service-Routen.

## Scanner und Sicherheitsbeobachtungen

- **Implementiert:** Öffentliche URL- und DNS-Prüfung, private/Loopback/
  Link-Local-/Metadata-/reservierte Netze, erneute Redirect-Prüfung,
  Redirect-Limit, HTTPS-Downgrade-/Origin-Signale, TLS-Zertifikatsstatus,
  Response-Größenlimit, Request-Body-Limit, Timeout-Deadline, HTTP-Status,
  JSON-/HTTP-Modus, Security-Header, Content-Type, Download/Binary/HTML/
  JavaScript-Klassifikation und einfache Shell-/Obfuscation-/Executable-
  Heuristiken.
- **Verbessert:** gzip, Brotli und deflate werden vor der Analyse mit einer
  maximalen entpackten Antwortgröße verarbeitet. Unbekannte oder verkettete
  Kompression wird abgewiesen. Übergrößenantworten beenden Response und
  Request kontrolliert.
- **Teilweise/Risiken:** DNS-Prüfung und TCP-Verbindung sind technisch nicht
  atomar; ein theoretisches Rebinding-/Routing-Rennen bleibt. Die Heuristiken
  sind bewusst keine Malware- oder Vulnerability-Scans. TLS nutzt die
  Node-Vertrauenskette, aber kein Pinning, keine externe Zertifikatsreputation
  und keine externe Threat Intelligence. Headerwerte werden nicht als
  inhaltliche Vertrauensbeweise behandelt.
- **Datenherkunft:** Threat-Indikatoren stammen aus Bond402-Heuristiken.
  Eine externe Reputation- oder Threat-Intel-Quelle ist nicht konfiguriert;
  Reputation bleibt `UNKNOWN`.
- **Tests:** SSRF, IPv6- und IPv4-mapped-SSRF, Redirect-SSRF, JSON, HTTP,
  HTML, Binary, verdächtige Payloads, False-Positive/Auth-/Rate-Limit-Fälle,
  TLS-/Header-Warnungen, Timeout, Redirect-Loop, Secret-Nichtleck,
  Kompression und komprimierte Oversize-Antworten. Echte
  Rebinding-DNS-Antworten und produktionsnahe Routing-Rennen bleiben offen.

## Security Confidence, Trust und Pre-Action

- **Implementiert:** Fakten (Erreichbarkeit, Status, Latenz, Struktur),
  Warnungen, `UNKNOWN`, `NOT_EVALUATED`, Threat-Indikatoren und historische
  Drift bleiben getrennt. Sample-Caps, unbekannte Reputation und Threat-Caps
  verhindern unbegrenzte Sicherheitsscores. ALLOW wird ausdrücklich nicht
  als Garantie dargestellt.
- **Teilweise:** Score und Confidence sind heuristische Beobachtungswerte,
  keine Zertifizierung, keine Malware-Freiheit und keine fachliche Freigabe
  für Zahlungen oder Credential-Nutzung.
- **Tests:** Security-Signals, Trust-Score, Trust-Metrics, Public-MVP und
  Pre-Action-Integration.

## Secret-Handling und Logging

- **Implementiert:** Zielauthentifizierung wird nur verwendet, wenn sie für
  den Dienst konfiguriert ist. Zielgeheimnisse werden verschlüsselt
  gespeichert, bei der Prüfung serverseitig entschlüsselt und nicht in
  Outcomes, Fingerprints, öffentlichen Antworten oder Logs geschrieben.
  Developer-API-Schlüssel werden nur als Hash gespeichert. Pino redigiert
  Authorization, Cookies und Set-Cookie; der lokale Secret-Leak-Test scannt
  getrackte Textdateien nach hochkonfidenten Mustern.
- **Teilweise:** Der Leak-Test ist kein vollständiger Secret-Scanner und
  ersetzt keine CI-/Deployment-Secret-Prüfung. Log-Aufbewahrung und
  zentrale Redaction-Verifikation in Produktion sind offen.
- **Tests:** Security-Signals, Public-MVP, Protected API, Service-Routen und
  `test:secret-leak`. Keine Secret-Werte wurden in diesem Audit ausgegeben.

## Rechtliche und Trust-Kommunikation

- **Implementiert:** Impressum-, Datenschutz-, Security-, Trust- und
  Disclaimer-Routen sind technisch auffindbar; öffentliche Discovery- und
  Pre-Action-Antworten kennzeichnen externe Quellen als unverifiziert.
  `ALLOW` und Trust Score werden als Risikoeinschätzung, nicht als
  Sicherheitsgarantie beschrieben.
- **Teilweise:** Die technische Konsistenz ist lokal geprüft, ersetzt aber
  keine rechtliche Freigabe. Rechtlich bindende Texte, Betreiberangaben,
  Aufbewahrung und internationale Datenverarbeitung bleiben
  **NEEDS LEGAL REVIEW**.
- **Tests:** Frontend-SEO, Frontend-Smoke, Public-MVP und Secret-Leak-Prüfung.

## Rate Limits, Abuse-Schutz und Limits

- **Implementiert:** DB-basierte öffentliche und ownerbezogene Minuten-
  Buckets, strengere Limits für externe Prüfungen, API-Key-/Owner-Limits,
  In-Memory-Limits für ungültige API-Schlüssel sowie Grenzen für URL,
  Request-Body, Response, Redirects und Zeit.
- **Teilweise/Risiken:** In-Memory-Limits für Login/API-Key-Fehler gelten
  nur pro Prozess. `trust proxy = 1` setzt eine genau eine vertrauenswürdige
  Proxy-Hop-Konfiguration voraus. Rate-Limit-Bereinigung/Retention und
  Multi-Instance-Verhalten sind nicht extern nachgewiesen.
- **Tests:** Public-MVP, Protected API, Security-Signals und Service-Safety.

## Background-Jobs, Fehlerbehandlung und Degradation

- **Implementiert:** Externe Discovery wird begrenzt und im Hintergrund
  gewärmt; interne Katalogantworten blockieren nicht auf einem kalten
  externen Cache. Read-Retry gilt nur für begrenzte idempotente DB-Lesewege.
  Schreibtransaktionen werden nicht automatisch wiederholt. Health und
  Readiness sind getrennt; Graceful Shutdown beendet HTTP-Server und DB-Pool.
- **Fehlt:** Keine durable Job-Queue, keine Wiederaufnahmegarantie über
  Prozessneustarts, kein zentrales Alarmierungs- oder Retry-Management.
- **Tests:** Public-external-discovery, DB-Resilienz, Service-Safety,
  Frontend-Smoke und Health-/API-Routen indirekt über Integrationsläufe.

## Tests, CI, Build und Dependencies

- **Implementiert:** Reproduzierbares `test:launch-gate` mit Workspace-
  Typecheck, Security-, Service-, Discovery-, Auth-, DB-, Ownership-,
  Schema-, UI-, Smoke-, SEO-, Restore- und Build-Schritten. Eine
  secrets-freie GitHub-Workflow-Vorlage führt das Gate und `pnpm audit`
  gegen eine isolierte Test-PostgreSQL aus.
- **Teilweise:** Der Workflow wurde lokal statisch geprüft, aber nicht in
  GitHub ausgeführt. Es gibt keinen echten Browser-E2E-Runner und keine
  Artefaktaufbewahrung. Der aktuelle lokale Dependency-, SAST- und
  HoundDog-Lauf ist ohne Findings; das ist eine Momentaufnahme und kein
  kontinuierlicher Überwachungsnachweis.
- **Bekannte Hinweise:** Der Frontend-Build meldet bestehende Sourcemap-
  Hinweise und Chunk-Größenwarnungen, beendet sich aber erfolgreich.

## Deployment, Health und Monitoring

- **Implementiert:** Vercel-Rewrite-/Frontend-Konfiguration,
  Replit-Autoscale-Konfiguration, `/api/healthz`, `/api/readyz`,
  strukturierte Request-IDs, no-store API-Header und sichere Standard-
  Sicherheitsheader.
- **Teilweise:** Die Statusseite zeigt Frontend, API und Datenbank getrennt
  und hat einen lokalen Fetch-Timeout. Health-/Readiness-Requests gegen
  eine tatsächlich veröffentlichte URL wurden nicht durchgeführt.
- **Fehlt/Risiko:** Kein nachgewiesenes externes Monitoring, Alerting,
  SLO-/SLA-Reporting oder Log-Retention; dafür liegt nur eine technische
  Vorbereitung vor. Produktionsdeployment,
  Rollback und externe DNS-/Proxy-/Mail-Verifikation sind offen.

## Backups und Restore

- **Implementiert:** Ein secrets-freies Backup-/Restore-Runbook und ein
  reproduzierbarer lokaler Test führen `pg_dump`, isolierten `pg_restore`,
  Integritätsprüfung, API-Start gegen die restaurierte Datenbank sowie
  Bereinigung aus.
- **Gemessen:** Letzter lokaler Fixture-Lauf: 106 ms Backup, 268 ms Restore,
  562 ms Restore bis Readiness, 4.651 ms Gesamtlauf. Lokales Fixture-RPO:
  0 Sekunden. Diese Werte sind keine Produktionsgarantie.
- **Offen:** Produktionsbackup, Produktionsrestore, Aufbewahrung und
  Betreiber-RPO/RTO wurden nicht verifiziert.

## Datenschutzrelevante Datenflüsse

- **Implementiert:** Konten, Sessiondaten, API-Key-Metadaten, Service-URLs,
  Checks und ausgewählte gelistete Trust-Daten bleiben im vorgesehenen
  Datenmodell. Öffentliche Antworten entfernen Owner-, Session- und
  Secret-Daten. Externe Live-Prüfungen rufen nur die konfigurierte bzw.
  explizit ableitbare Ziel-URL auf; externe Discovery-Preflights senden
  keine Secrets.
- **Teilweise:** Bei eigenen Ziel-APIs entstehen Netzwerkdatenflüsse zu
  deren Betreibern; Retention, Löschung und internationale
  Verarbeitungspartner benötigen Betreiber-/Rechtsprüfung. Resend,
  Hosting-, Datenbank- und Font-Anbieter sind dokumentiert, aber ihre
  aktuelle Produktionskonfiguration ist nicht aus dem lokalen Code
  beweisbar.
- **Risiko:** URL-, Antwortmetadaten- und Betriebsdaten können
  personenbezogene oder vertrauliche Informationen enthalten; deshalb
  bleiben Responses und Logs inhaltlich minimiert.

## Abhängigkeiten, technische Schulden und Single Points of Failure

- **Abhängigkeiten:** Node 24, PNPM, React/Vite, Express, Drizzle/
  PostgreSQL, Zod/Orval, Pino, Vercel-/Render-/Neon-/Resend-
  Betriebsannahmen und die externe APIs.guru-Quelle.
- **Technische Schulden:** Keine Browser-E2E-Suite, keine globale
  Rate-Limit-Instanz, keine Observation-Retention, nicht-transaktionale
  Check-/Observation-Speicherung, große Frontend-Bundles und fehlende
  Mehrregionenüberwachung.
- **Single Points of Failure:** PostgreSQL, API-Prozess, Frontend-Proxy,
  externe Discovery-Quelle und der einzelne öffentliche Zielpfad eines
  Dienstes. Die App degradiert bei DB-/Discovery-/Scannerfehlern teilweise,
  beseitigt diese Abhängigkeiten aber nicht.

## Gesamturteil

Der lokale Code- und Teststand ist für die fünf Launch-Blöcke technisch
deutlich belastbarer: First-Seen-Promotion, Kompressionsanalyse, IPv6-SSRF-
Regressionen, explizite externe Zielableitung, Status-Timeouts, lokaler
Restore-Nachweis, kontrollierte externe Routen und ein vollständig
bestandenes lokales Launch-Gate sind abgesichert. Nicht abgeschlossen bzw.
nicht verifiziert bleiben Browser-E2E, echte Rebinding-Integration,
GitHub-CI-Ausführung, Produktions-Scans, Monitoring/Alerting, externe
Mail-/Health-/DNS-Checks, Deployment/Rollback und rechtliche Freigaben.
Diese Punkte werden nicht als live, produktiv oder rechtlich freigegeben
dargestellt.