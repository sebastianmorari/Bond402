import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;

const expectedColumns = [
  ["bond402_public_discovery_records", "id"],
  ["bond402_public_discovery_records", "canonical_url"],
  ["bond402_public_discovery_records", "source"],
  ["bond402_public_discovery_records", "source_url"],
  ["bond402_public_discovery_records", "name"],
  ["bond402_public_discovery_records", "description"],
  ["bond402_public_discovery_records", "provider"],
  ["bond402_public_discovery_records", "version"],
  ["bond402_public_discovery_records", "discovered_at"],
  ["bond402_public_discovery_records", "last_seen_at"],
  ["bond402_public_discovery_records", "verification_status"],
  ["bond402_public_discovery_records", "trust_status"],
  ["bond402_api_services", "source_type"],
  ["bond402_api_services", "source_provider"],
  ["bond402_api_services", "source_url"],
  ["bond402_api_services", "auth_requirement"],
  ["bond402_api_services", "discovery_metadata"],
  ["bond402_api_services", "expected_structure"],
  ["bond402_api_services", "response_mode"],
  ["bond402_api_services", "max_response_time"],
  ["bond402_api_services", "visibility"],
  ["bond402_api_services", "request_method"],
  ["bond402_api_services", "target_auth_type"],
  ["bond402_api_services", "target_auth_header_name"],
  ["bond402_api_services", "target_auth_secret_ciphertext"],
  ["bond402_api_services", "request_body"],
  ["bond402_api_services", "listed_at"],
  ["bond402_api_services", "domain_verification_token_hash"],
  ["bond402_api_services", "domain_verification_issued_at"],
  ["bond402_api_services", "domain_verified_at"],
  ["bond402_api_services", "domain_relationship"],
  ["bond402_api_services", "updated_at"],
  ["bond402_api_services", "security_status"],
  ["bond402_api_services", "first_seen_at"],
  ["bond402_api_services", "sandbox_observed_at"],
  ["bond402_api_checks", "security_signals"],
  ["bond402_security_observations", "id"],
  ["bond402_security_observations", "service_id"],
  ["bond402_security_observations", "observed_at"],
  ["bond402_security_observations", "status"],
  ["bond402_security_observations", "response_fingerprint"],
  ["bond402_security_observations", "response_kind"],
  ["bond402_security_observations", "response_size_bucket"],
  ["bond402_security_observations", "header_fingerprint"],
  ["bond402_security_observations", "redirect_targets"],
  ["bond402_security_observations", "tls_fingerprint"],
  ["bond402_security_observations", "latency_bucket"],
  ["bond402_security_observations", "indicators"],
  ["bond402_threat_indicators", "id"],
  ["bond402_threat_indicators", "indicator_type"],
  ["bond402_threat_indicators", "normalized_value"],
  ["bond402_threat_indicators", "verdict"],
  ["bond402_threat_indicators", "severity"],
  ["bond402_threat_indicators", "confidence"],
  ["bond402_threat_indicators", "source"],
  ["bond402_threat_indicators", "source_checked_at"],
  ["bond402_threat_indicators", "first_seen_at"],
  ["bond402_threat_indicators", "last_seen_at"],
  ["bond402_threat_indicators", "metadata"],
];

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

test("Public- und Security-Schema enthält alle vom ORM gelesenen Spalten", () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist für den Public-Katalog-Schema-Test erforderlich.");
  }

  const values = expectedColumns
    .map(([tableName, columnName]) => `(${sqlLiteral(tableName)}, ${sqlLiteral(columnName)})`)
    .join(",\n    ");
  const sql = `
    WITH expected(table_name, column_name) AS (
      VALUES
        ${values}
    )
    SELECT expected.table_name || '.' || expected.column_name
    FROM expected
    LEFT JOIN information_schema.columns AS actual
      ON actual.table_schema = 'public'
      AND actual.table_name = expected.table_name
      AND actual.column_name = expected.column_name
    WHERE actual.column_name IS NULL
    ORDER BY expected.table_name, expected.column_name;
  `;

  const missingColumns = execFileSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

  assert.equal(missingColumns, "", `Fehlende Public-Katalog-Spalten: ${missingColumns}`);
});

test("Security-Schema enthält die erforderlichen Primärschlüssel und Foreign Keys", () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist für den Public-Katalog-Schema-Test erforderlich.");
  }

  const sql = `
    WITH expected_indexes(table_name, index_name) AS (
      VALUES
        ('bond402_security_observations', 'bond402_security_observations_pkey'),
        ('bond402_threat_indicators', 'bond402_threat_indicators_pkey')
    ),
    expected_foreign_keys(table_name, referenced_table) AS (
      VALUES
        ('bond402_security_observations', 'bond402_api_services')
    )
    SELECT 'index:' || expected_indexes.table_name || '.' || expected_indexes.index_name
    FROM expected_indexes
    LEFT JOIN pg_indexes AS actual
      ON actual.schemaname = 'public'
      AND actual.tablename = expected_indexes.table_name
      AND actual.indexname = expected_indexes.index_name
    WHERE actual.indexname IS NULL
    UNION ALL
    SELECT 'foreign-key:' || expected_foreign_keys.table_name || '->' || expected_foreign_keys.referenced_table
    FROM expected_foreign_keys
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
      JOIN pg_class AS referenced_row ON referenced_row.oid = constraint_row.confrelid
      JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
      WHERE namespace_row.nspname = 'public'
        AND table_row.relname = expected_foreign_keys.table_name
        AND referenced_row.relname = expected_foreign_keys.referenced_table
        AND constraint_row.contype = 'f'
    )
    ORDER BY 1;
  `;

  const missingKeys = execFileSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

  assert.equal(missingKeys, "", `Fehlende Security-Schlüssel: ${missingKeys}`);
});

test("Public-Discovery-Deduplizierung ist über eine eindeutige kanonische URL abgesichert", () => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ist für den Public-Katalog-Schema-Test erforderlich.");
  }

  const sql = `
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'bond402_public_discovery_records'
      AND indexname = 'bond402_public_discovery_records_canonical_url_idx';
  `;
  const indexName = execFileSync(
    "psql",
    [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

  assert.equal(indexName, "bond402_public_discovery_records_canonical_url_idx");
});