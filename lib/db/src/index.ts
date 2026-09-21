import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function ensureBond402OAuthSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('bond402_oauth_schema_v1'))");

    await client.query(`
      CREATE TABLE IF NOT EXISTS bond402_api_rate_limits (
        identity text NOT NULL,
        scope text NOT NULL,
        window_start timestamp with time zone NOT NULL,
        count integer NOT NULL,
        PRIMARY KEY (identity, scope)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bond402_oauth_clients (
        client_id text PRIMARY KEY,
        client_name text NOT NULL,
        redirect_uris text NOT NULL,
        grant_types text NOT NULL DEFAULT 'authorization_code,refresh_token',
        response_types text NOT NULL DEFAULT 'code',
        token_endpoint_auth_method text NOT NULL DEFAULT 'none',
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        last_used_at timestamp with time zone,
        revoked_at timestamp with time zone
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bond402_oauth_authorization_codes (
        id text PRIMARY KEY,
        code_hash text NOT NULL,
        client_id text NOT NULL REFERENCES bond402_oauth_clients(client_id) ON DELETE CASCADE,
        owner_id text NOT NULL REFERENCES bond402_users(id) ON DELETE CASCADE,
        redirect_uri text NOT NULL,
        scopes text NOT NULL,
        code_challenge text NOT NULL,
        code_challenge_method text NOT NULL,
        resource text NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        expires_at timestamp with time zone NOT NULL,
        consumed_at timestamp with time zone
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bond402_oauth_authorization_requests (
        id text PRIMARY KEY,
        request_hash text NOT NULL,
        client_id text NOT NULL REFERENCES bond402_oauth_clients(client_id) ON DELETE CASCADE,
        owner_id text REFERENCES bond402_users(id) ON DELETE CASCADE,
        redirect_uri text NOT NULL,
        scopes text NOT NULL,
        state text NOT NULL,
        code_challenge text NOT NULL,
        code_challenge_method text NOT NULL,
        resource text NOT NULL,
        csrf_hash text,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        expires_at timestamp with time zone NOT NULL,
        consumed_at timestamp with time zone
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bond402_oauth_access_tokens (
        id text PRIMARY KEY,
        token_hash text NOT NULL,
        client_id text NOT NULL REFERENCES bond402_oauth_clients(client_id) ON DELETE CASCADE,
        owner_id text NOT NULL REFERENCES bond402_users(id) ON DELETE CASCADE,
        resource text NOT NULL,
        scopes text NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        expires_at timestamp with time zone NOT NULL,
        last_used_at timestamp with time zone,
        revoked_at timestamp with time zone
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bond402_oauth_refresh_tokens (
        id text PRIMARY KEY,
        token_hash text NOT NULL,
        family_id text NOT NULL,
        client_id text NOT NULL REFERENCES bond402_oauth_clients(client_id) ON DELETE CASCADE,
        owner_id text NOT NULL REFERENCES bond402_users(id) ON DELETE CASCADE,
        resource text NOT NULL,
        scopes text NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        expires_at timestamp with time zone NOT NULL,
        used_at timestamp with time zone,
        revoked_at timestamp with time zone,
        replaced_by_id text
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bond402_oauth_clients_client_id_idx
        ON bond402_oauth_clients (client_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bond402_oauth_codes_hash_idx
        ON bond402_oauth_authorization_codes (code_hash)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS bond402_oauth_codes_expiry_idx
        ON bond402_oauth_authorization_codes (expires_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS bond402_oauth_codes_client_idx
        ON bond402_oauth_authorization_codes (client_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bond402_oauth_requests_hash_idx
        ON bond402_oauth_authorization_requests (request_hash)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS bond402_oauth_requests_expiry_idx
        ON bond402_oauth_authorization_requests (expires_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS bond402_oauth_requests_client_idx
        ON bond402_oauth_authorization_requests (client_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bond402_oauth_access_hash_idx
        ON bond402_oauth_access_tokens (token_hash)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS bond402_oauth_access_expiry_idx
        ON bond402_oauth_access_tokens (expires_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS bond402_oauth_access_owner_idx
        ON bond402_oauth_access_tokens (owner_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS bond402_oauth_refresh_hash_idx
        ON bond402_oauth_refresh_tokens (token_hash)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS bond402_oauth_refresh_family_idx
        ON bond402_oauth_refresh_tokens (family_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS bond402_oauth_refresh_expiry_idx
        ON bond402_oauth_refresh_tokens (expires_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS bond402_oauth_refresh_owner_idx
        ON bond402_oauth_refresh_tokens (owner_id)
    `);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export * from "./schema";
