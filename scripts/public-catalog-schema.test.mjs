import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const databaseUrl = process.env.DATABASE_URL;

const expectedColumns = [
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
];

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

test("Public-Katalog-Schema enthält alle vom ORM gelesenen Spalten", () => {
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