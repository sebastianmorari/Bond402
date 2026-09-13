# Bond402 Backup und Restore

## Zweck

Dieses Dokument beschreibt den sicheren Ablauf für PostgreSQL-Sicherungen und
Restore-Tests. Es enthält keine Zugangsdaten und führt selbst keine
Produktionsänderung aus.

## Aktueller Status

- Die Anwendung nutzt PostgreSQL über `DATABASE_URL`.
- Das lokale Schema wird mit Drizzle verwaltet.
- Der reproduzierbare lokale Test ist
  `pnpm run test:backup-restore`. Er erstellt temporäre Quelldatenbanken,
  führt einen Dump und Restore in eine frische Zieldatenbank aus, prüft die
  Integrität und startet die API gegen die restaurierte Datenbank.
- Ein echter Produktions-Restore ist in dieser Umgebung **nicht verifiziert**.
- `pnpm --filter @workspace/db run push` ist ausschließlich für die
  Entwicklung vorgesehen und ersetzt keine versionierte Produktionsmigration.

## Backup vor einer riskanten Änderung

1. Schreibende Jobs und Deployments anhalten oder ein Wartungsfenster festlegen.
2. Die zu verwendende, geschützte Backup-Umgebung und Aufbewahrungsfrist
   dokumentieren.
3. Mit einem Operator-verwalteten `DATABASE_URL` ein komprimiertes,
   benutzerdefiniertes Dump erzeugen:

   ```bash
   pg_dump --format=custom --file=bond402-<utc-timestamp>.dump "$DATABASE_URL"
   ```

4. Dump-Größe, SHA-256-Prüfsumme und Erstellungszeit getrennt vom Dump
   protokollieren.
5. Das Backup verschlüsselt und zugriffsbeschränkt außerhalb des Repositories
   aufbewahren. Dumps dürfen niemals committed, geloggt oder in Tickets
   hochgeladen werden.

## Restore-Test in einer isolierten Datenbank

1. Eine leere, isolierte PostgreSQL-Datenbank bereitstellen.
2. Das Dump nur in dieser Testdatenbank wiederherstellen:

   ```bash
   createdb bond402_restore_test
   pg_restore --exit-on-error --clean --if-exists \
     --dbname=bond402_restore_test bond402-<utc-timestamp>.dump
   ```

3. Tabellenanzahl, Migration-/Schema-Version, Auth-Sessions und repräsentative
   Service-/Check-Datensätze prüfen.
4. Einen Read-only Health-/Readiness-Check gegen die isolierte Datenbank
   ausführen.
5. Die Testdatenbank und lokale Dump-Kopie nach dem Test sicher löschen.

## Wiederanlauf und Rollback

- Bei einem fehlgeschlagenen Restore nicht auf die Quelldatenbank schreiben.
- Erst Ursache, Dump-Prüfsumme und Zielumgebung dokumentieren.
- Für einen produktiven Rollback muss ein Operator eine geprüfte,
  versionierte Migration oder einen freigegebenen Restore verwenden.
- Ein Drizzle-Schema-Push ist kein Rollback-Mechanismus.

## RPO/RTO

RPO, RTO, Aufbewahrung, Verschlüsselung und Restore-Frequenz müssen vor einem
Produktionslaunch durch den Betreiber festgelegt und nach jedem Restore-Test
aktualisiert werden.

Der letzte lokale Fixture-Lauf am 13.09.2026 maß:

- Backup: 106 ms
- Restore: 268 ms
- Restore bis API-Readiness: 562 ms
- Gesamtlauf: 4.651 ms
- Lokales Fixture-RPO: 0 Sekunden zwischen Fixture-Schreibvorgang und Backup

Diese Werte gelten nur für die temporäre lokale Testdatenbank und sind keine
Produktions-RPO/RTO-Garantie. Ein Produktionsbackup, ein Produktionsrestore,
Aufbewahrung und Wiederanlauf unter realer Last bleiben **nicht verifiziert**.