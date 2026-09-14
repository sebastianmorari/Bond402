# Bond402 Monitoring- und Alerting-Vorbereitung

Dieses Dokument beschreibt die technische Vorbereitung für Monitoring und
Alarmierung. Es aktiviert keinen externen Dienst, sendet keine Daten und ist
kein Nachweis für eine laufende Produktionsüberwachung.

## Bereits vorhandene Signale

- `GET /api/healthz` zeigt, ob der API-Prozess antwortet.
- `GET /api/readyz` prüft zusätzlich die Datenbankbereitschaft.
- Jeder API-Request erhält eine `X-Request-ID`.
- Pino schreibt strukturierte Request- und Fehlerereignisse.
- Authorization-, Cookie- und Set-Cookie-Header werden redigiert.
- API-Antworten unter `/api` verwenden `Cache-Control: no-store`.

## Empfohlene Read-only-Prüfung

Ein Betreiber kann die beiden Endpunkte getrennt und ohne Nutzerdaten abfragen:

1. `/api/healthz` in kurzen Intervallen für Liveness.
2. `/api/readyz` für Readiness einschließlich Datenbank.
3. Bei einem Readiness-Fehler zuerst die `X-Request-ID` und den Zeitraum
   dokumentieren, nicht wiederholt Scan- oder Schreibendpunkte aufrufen.

Konkrete Schwellenwerte, Eskalationswege und Aufbewahrungsfristen müssen vor
einem Produktionsbetrieb vom Betreiber festgelegt werden. Sie werden hier nicht
als aktiv konfiguriert behauptet.

## Sinnvolle Alarmklassen

- **Prozess:** Health-Endpoint wiederholt nicht erreichbar.
- **Datenbank:** Readiness fehlschlägt oder `DATABASE_UNAVAILABLE` zunimmt.
- **Abuse:** Häufung von `RATE_LIMITED`, `PRIVATE_ADDRESS`,
  `UNSAFE_REDIRECT` oder `RESPONSE_TOO_LARGE`.
- **Fehler:** Anstieg von `INTERNAL_ERROR` nach Route und Request-ID.
- **Datenqualität:** Security-Observations oder Checks werden wegen alter oder
  ungültiger Schemafelder verworfen.

Diese Klassen sind Beobachtungssignale. Sie sind weder Sicherheitszertifikate
noch automatische Freigaben.

## Noch offen

- Externer Monitoring- und Alerting-Dienst ist nicht eingerichtet.
- Log-Aufbewahrung, Zugriffsschutz und Redaction müssen in der Betriebsumgebung
  nachgewiesen werden.
- Es gibt keine durable Job-Queue und keine automatische Incident-Eskalation.
- Produktions-Health-Requests und echte Alarmtests wurden nicht ausgeführt.