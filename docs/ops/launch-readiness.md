# Bond402 lokaler Launch-Readiness-Stand

## Nachweisbare lokale Gates

- Typecheck: `pnpm run typecheck`
- API-Build: `pnpm --filter @workspace/api-server run build`
- Web-Build: `PORT=4173 BASE_PATH=/ pnpm --filter @workspace/bond402 run build`
- Sicherheitsregressionen: `pnpm run test:security-signals`
- Öffentliche MVP-/Discovery-/Service-Routentests: die jeweiligen
  `test:*`-Scripts in `package.json`
- Diff-Prüfung: `git diff --check`

## Nicht behaupten

- Kein Push zu `origin/main`, solange kein Push explizit ausgeführt und
  bestätigt wurde.
- Kein Produktions- oder Public-Beta-Status, solange kein Deployment und
  eine echte externe Verifikation nachgewiesen sind.
- Keine Reputation oder Threat-Intel als „sicher“ darstellen, wenn nur
  `NONE_DETECTED` oder eine unbekannte Quelle vorliegt.
- Kein Restore als verifiziert darstellen, solange er nicht in einer
  isolierten Zielumgebung erfolgreich getestet wurde.

## Offene Betreiber-/Umgebungsnachweise

- Produktions-Backup und getesteter Restore
- RPO/RTO und Aufbewahrung
- Deployment-/Rollback-Pipeline
- Secret- und Dependency-Scan in CI
- Monitoring, Alerting und Log-Aufbewahrung
- Rechtlich freigegebene Support-/Terms-Prozesse

Diese Punkte sind externe Betriebsnachweise; sie werden nicht durch einen
lokalen Build ersetzt.