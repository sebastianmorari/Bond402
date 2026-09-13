import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const API_DIST = path.join(ROOT, "artifacts", "api-server", "dist", "index.mjs");
const REQUIRED_TABLES = [
  "bond402_api_checks",
  "bond402_api_services",
  "bond402_security_observations",
  "bond402_sessions",
  "bond402_threat_indicators",
  "bond402_users",
];

function run(command, args, env, label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    input: options.input,
    stdio: options.input === undefined ? ["ignore", "ignore", "ignore"] : ["pipe", "ignore", "ignore"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} fehlgeschlagen (Exit ${result.status ?? "spawn"}).`);
  }
  return result;
}

function runQuery(database, sql, env) {
  const result = spawnSync(
    "psql",
    ["--dbname", database, "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", sql],
    { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`Integritätsabfrage fehlgeschlagen (Exit ${result.status ?? "spawn"}).`);
  }
  return result.stdout.trim();
}

function makeDatabaseEnv(databaseUrl) {
  const source = new URL(databaseUrl);
  const env = { ...process.env };
  env.PGHOST = source.hostname;
  env.PGPORT = source.port || "5432";
  env.PGUSER = decodeURIComponent(source.username);
  env.PGPASSWORD = decodeURIComponent(source.password);
  env.PGDATABASE = decodeURIComponent(source.pathname.slice(1));
  const sslMode = source.searchParams.get("sslmode");
  if (sslMode) env.PGSSLMODE = sslMode;
  delete env.DATABASE_URL;
  return { source, env };
}

function databaseUrlFor(source, database) {
  const target = new URL(source.toString());
  target.pathname = `/${database}`;
  return target.toString();
}

function seedFixture(database, env) {
  const sql = `
    INSERT INTO bond402_users (id, email, display_name, password_hash, email_verification_required)
    VALUES ('restore-user', 'restore-fixture@example.invalid', 'Restore Fixture', 'fixture-hash-not-a-secret', false);
    INSERT INTO bond402_sessions (id, user_id, token_hash, expires_at)
    VALUES ('restore-session', 'restore-user', 'fixture-token-hash', NOW() + INTERVAL '1 hour');
    INSERT INTO bond402_api_services (id, owner_id, name, url, expected_structure, max_response_time)
    VALUES ('restore-service', 'restore-user', 'Restore Fixture Service', 'https://restore-fixture.invalid/api', '{}', 1000);
    INSERT INTO bond402_api_checks (
      id, service_id, status, check_type, reachable, response_time_ms, structure_match, summary
    )
    VALUES ('restore-check', 'restore-service', 'PASS', 'LIVE', true, 42, true, 'Deterministic restore fixture.');
    INSERT INTO bond402_security_observations (
      id, service_id, status, response_fingerprint, response_kind, response_size_bucket,
      header_fingerprint, tls_fingerprint, latency_bucket
    )
    VALUES (
      'restore-observation', 'restore-service', 'NONE_DETECTED', 'fixture-response',
      'JSON', 'SMALL', 'fixture-headers', 'fixture-tls', 'FAST'
    );
    INSERT INTO bond402_threat_indicators (
      id, indicator_type, normalized_value, verdict, severity, confidence, source, metadata
    )
    VALUES (
      'restore-threat', 'PAYLOAD_HEURISTIC', 'fixture-indicator', 'NONE_DETECTED',
      'LOW', '0', 'BOND402_TEST_FIXTURE', '{"fixture":true}'::jsonb
    );
  `;
  run("psql", ["--dbname", database, "--set", "ON_ERROR_STOP=1"], env, "Fixture-Daten", { input: sql });
}

function waitForHttp(port, pathName, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const request = http.get({ hostname: "127.0.0.1", port, path: pathName }, (response) => {
      response.resume();
      response.on("end", () => {
        if (response.statusCode === 200) {
          resolve(performance.now() - startedAt);
        } else {
          reject(new Error(`${pathName} lieferte HTTP ${response.statusCode}.`));
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`${pathName} Timeout.`));
    });
    request.on("error", reject);
  });
}

async function startAndCheckApi(databaseUrl, env) {
  const port = 30_000 + Math.floor(Math.random() * 10_000);
  const child = spawn("node", [API_DIST], {
    cwd: ROOT,
    env: { ...env, DATABASE_URL: databaseUrl, NODE_ENV: "development", PORT: String(port) },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const startedAt = performance.now();
  let lastError;
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error("API-Prozess wurde vor dem Health-Check beendet.");
      try {
        await waitForHttp(port, "/api/healthz", 500);
        await waitForHttp(port, "/api/readyz", 500);
        return performance.now() - startedAt;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(`API-Startpfad wurde nicht bereit: ${lastError?.message ?? "unbekannter Fehler"}`);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

test("isolierter Backup-/Restore-Test mit Startpfad und Integritätsprüfung", async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Test darf nicht gegen NODE_ENV=production laufen.");
  assert.equal(process.env.BOND402_BACKUP_RESTORE_TEST, "1", "Explizite Testfreigabe fehlt.");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL für die Entwicklungsdatenbank fehlt.");
  assert.ok(existsSync(API_DIST), "API-Build fehlt; zuerst den API-Build ausführen.");

  const { source, env: baseEnv } = makeDatabaseEnv(process.env.DATABASE_URL);
  const sourceDatabase = decodeURIComponent(source.pathname.slice(1));
  assert.ok(sourceDatabase, "Quelldatenbank konnte nicht bestimmt werden.");

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const sourceTempDatabase = `bond402_restore_source_${suffix}`;
  const restoredDatabase = `bond402_restore_target_${suffix}`;
  const dumpPath = path.join("/tmp", `${sourceTempDatabase}.dump`);
  const sourceUrl = databaseUrlFor(source, sourceTempDatabase);
  const restoredUrl = databaseUrlFor(source, restoredDatabase);
  const sourceEnv = { ...baseEnv, PGDATABASE: sourceDatabase, DATABASE_URL: sourceUrl };
  const targetEnv = { ...baseEnv, PGDATABASE: restoredDatabase, DATABASE_URL: restoredUrl };

  const startedAt = performance.now();
  let restoreStartedAt = 0;
  let readyAt = 0;
  try {
    run("createdb", [sourceTempDatabase], sourceEnv, "Temporäre Quelldatenbank");
    run("pnpm", ["--filter", "@workspace/db", "run", "push"], sourceEnv, "Drizzle-Schema-Push");
    seedFixture(sourceTempDatabase, sourceEnv);

    const backupStartedAt = performance.now();
    run("pg_dump", ["--format=custom", "--file", dumpPath, "--dbname", sourceTempDatabase], sourceEnv, "Backup");
    const backupDurationMs = Math.round(performance.now() - backupStartedAt);

    run("createdb", [restoredDatabase], sourceEnv, "Frische Restore-Zieldatenbank");
    restoreStartedAt = performance.now();
    run(
      "pg_restore",
      ["--exit-on-error", "--clean", "--if-exists", "--dbname", restoredDatabase, dumpPath],
      targetEnv,
      "Restore",
    );
    const restoreDurationMs = Math.round(performance.now() - restoreStartedAt);

    const tableNames = runQuery(
      restoredDatabase,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'bond402_%' ORDER BY table_name;",
      targetEnv,
    ).split("\n").filter(Boolean);
    for (const requiredTable of REQUIRED_TABLES) {
      assert.ok(tableNames.includes(requiredTable), `Tabelle ${requiredTable} fehlt nach Restore.`);
    }

    const counts = runQuery(
      restoredDatabase,
      `
        SELECT
          (SELECT count(*) FROM bond402_users),
          (SELECT count(*) FROM bond402_sessions),
          (SELECT count(*) FROM bond402_api_services),
          (SELECT count(*) FROM bond402_api_checks),
          (SELECT count(*) FROM bond402_security_observations),
          (SELECT count(*) FROM bond402_threat_indicators),
          (SELECT count(*) FROM bond402_api_services s JOIN bond402_api_checks c ON c.service_id = s.id WHERE s.id = 'restore-service' AND c.id = 'restore-check');
      `,
      targetEnv,
    );
    assert.equal(counts, "1|1|1|1|1|1|1", "Fixture-Integrität nach Restore stimmt nicht.");

    const apiReadyDurationMs = await startAndCheckApi(restoredUrl, targetEnv);
    readyAt = performance.now();
    const totalDurationMs = Math.round(performance.now() - startedAt);
    const restoreToReadyDurationMs = Math.round(readyAt - restoreStartedAt);
    console.log(JSON.stringify({
      backupDurationMs,
      restoreDurationMs,
      apiReadyDurationMs: Math.round(apiReadyDurationMs),
      restoreToReadyDurationMs,
      totalDurationMs,
      restoredTableCount: tableNames.length,
      rpoInterpretation: "0 Sekunden im Fixture-Test zwischen Fixture-Schreibvorgang und Backup; kein Produktions-RPO.",
      rtoInterpretation: `${restoreToReadyDurationMs} ms vom Restore-Start bis API healthz/readyz im lokalen Test; kein Produktions-RTO.`,
    }));
  } finally {
    run("dropdb", ["--if-exists", restoredDatabase], sourceEnv, "Restore-Zieldatenbank bereinigen");
    run("dropdb", ["--if-exists", sourceTempDatabase], sourceEnv, "Temporäre Quelldatenbank bereinigen");
    rmSync(dumpPath, { force: true });
  }
});