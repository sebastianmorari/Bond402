# Bond402 lokaler Launch-Readiness-Stand

## Nachweisbare lokale Gates

- Kombinierter Lauf: `pnpm run test:launch-gate`
- Typecheck: `pnpm run typecheck`
- API-Build: `pnpm --filter @workspace/api-server run build`
- Web-Build: `PORT=4173 BASE_PATH=/ pnpm --filter @workspace/bond402 run build`
- Sicherheitsregressionen: `pnpm run test:security-signals`
- Externe Detail- und OpenAPI-Kandidaten: `pnpm run test:public-external-detail`
- Isolierter Backup-/Restore-Test: `pnpm run test:backup-restore`
- Lokaler Browser-E2E-Test mit synthetischen API-Fixtures:
  `pnpm run test:frontend-e2e`
- Auth-/Datenbank-Resilienz und lokaler Secret-Leak-Test:
  `pnpm run test:auth-session`, `pnpm run test:database-resilience`,
  `pnpm run test:secret-leak`
- Öffentliche MVP-/Discovery-/Service-Routentests: die jeweiligen
  `test:*`-Scripts in `package.json`
- Diff-Prüfung: `git diff --check`

Das reproduzierbare Gate enthält jetzt auch den isolierten Restore-, den
externen Detail- und den externen Routen-Sicherheitstest. Der aktuelle
vollständige lokale Lauf ist erfolgreich durchgelaufen. Die kostenlosen
Dependency-, SAST- und HoundDog-Prüfungen meldeten dabei keine Findings.
Das beweist weder einen GitHub-CI-Lauf noch einen Produktionsstand.

## Nicht behaupten

- Kein Push zu `origin/main`, solange kein Push explizit ausgeführt und
  bestätigt wurde.
- Kein Produktions- oder Public-Beta-Status, solange kein Deployment und
  eine echte externe Verifikation nachgewiesen sind.
- Keine Reputation oder Threat-Intel als „sicher“ darstellen, wenn nur
  `NONE_DETECTED` oder eine unbekannte Quelle vorliegt.
- Der lokale isolierte Restore darf als lokaler Testnachweis bezeichnet werden;
  ein Produktionsrestore bleibt ausdrücklich **NOT VERIFIED**.

## Offene Betreiber-/Umgebungsnachweise

- Produktions-Backup und getesteter Restore
- RPO/RTO und Aufbewahrung
- Deployment-/Rollback-Pipeline
- Secret- und Dependency-Scan in CI
- Monitoring, Alerting und Log-Aufbewahrung
- Rechtlich freigegebene Support-/Terms-Prozesse
- Browser-E2E gegen eine reale veröffentlichte Umgebung
- Browserinstallation und Ausführung des E2E-Tests in GitHub CI

Der lokale Fixture-Browserlauf ist kein Nachweis gegen Produktion und ersetzt
keine CI-Browserinstallation. Diese Punkte sind externe Betriebsnachweise; sie
werden nicht durch einen lokalen Build ersetzt.