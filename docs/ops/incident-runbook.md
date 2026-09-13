# Bond402 Incident-Runbook

Dieses Runbook ist eine technische Orientierung und keine Rechtsberatung.
Keine Maßnahme hier enthält Zugangsdaten oder sendet Daten an externe
Dienste.

## Erste 10 Minuten

1. Incident-Zeitpunkt, betroffene Route, `X-Request-ID`, HTTP-Status und
   letzte bekannte Änderung festhalten.
2. Keine Secrets, Cookies, Authorization-Header, Sessions, Owner-IDs oder
   Response-Bodies in Tickets oder Chat kopieren.
3. `/api/healthz` und `/api/readyz` getrennt prüfen:
   - `healthz` zeigt Prozess-/Liveness-Zustand.
   - `readyz` zeigt, ob die Datenbank verfügbar ist.
4. Einen betroffenen Prüf- oder Discovery-Endpunkt nicht wiederholt aufrufen,
   wenn ein Spam-, SSRF- oder Ressourcenproblem möglich ist.

## Szenarien

### Session- oder Ownership-Verdacht

- Betroffene Session serverseitig invalidieren.
- Prüfen, dass jede Service-, Check-, Key- und Historienabfrage den Besitzer
  berücksichtigt.
- Keine fremden Datensätze manuell in der Datenbank kopieren.
- Passwort-/Session-Rotation nur über den vorgesehenen Auth-Flow ausführen.

### Secret- oder API-Key-Verdacht

- Betroffene Zielauthentifizierung und Developer-Keys sperren oder rotieren.
- Logs auf Secret-Leaks prüfen, ohne die Werte selbst zu exportieren.
- Keine Secrets an Support, Threat-Intel-Quellen oder Test-Tools weitergeben.
- Nach der Rotation einen Read-only Health- und Ownership-Test ausführen.

### SSRF-, Scanner- oder Discovery-Missbrauch

- Öffentliche Discovery- und Preflight-Routen temporär rate-limitieren oder
  abschalten, falls das ohne Datenverlust nötig ist.
- Keine privaten, Loopback-, Link-local-, Metadata- oder Redirect-Ziele
  freigeben.
- Response-Größe, Redirect-Anzahl und Timeout nicht erhöhen, um einen
  einzelnen Dienst zu „reparieren“.
- Externe Beschreibungen niemals als HTML oder Script rendern.

### Threat- oder Malware-Hinweis

- Dienststatus auf Beobachtung/SUSPICIOUS/FLAGGED belassen.
- Keine automatische Ausführung, kein Download und kein Öffnen von Archiven.
- Bond402-Heuristik, Quelle, Zeitstempel und relevante Fingerprint-Änderung
  dokumentieren.
- Auth-Fehler wie 401/403/429 nicht ohne zusätzliche Evidenz als Malware
  klassifizieren.

### Datenbankausfall

- `readyz` und Datenbankfehler mit Request-ID prüfen.
- Keine Schemaänderung und keinen ungezielten `db push` während des Incidents.
- Vor Restore oder Migration Backup-/Restore-Runbook befolgen.

## Wiederfreigabe

Eine abgeschaltete Prüf- oder Discovery-Funktion wird erst nach einem
erfolgreichen Typecheck, relevanten Security-Tests, Build und einem
Read-only Smoke-Test wieder aktiviert. Ein einzelner erfolgreicher Request
ist kein Sicherheitsnachweis.

## Nachbereitung

- Zeitlinie, Auswirkung, Erkennung, Eindämmung und dauerhafte Korrektur
  festhalten.
- Betroffene Nutzer nur mit den tatsächlich bestätigten Fakten informieren.
- Keine absoluten Aussagen wie „sicher“, „virusfrei“ oder „kein Risiko“
  verwenden.