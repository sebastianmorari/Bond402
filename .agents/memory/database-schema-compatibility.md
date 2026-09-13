---
name: Database schema compatibility
description: Avoid unsafe automatic type changes when synchronizing the development schema.
---

When a development table already exists with a compatible textual representation, do not change that column to a numeric PostgreSQL type through a normal Drizzle push; use the existing representation unless an explicit migration with a safe cast is requested.

**Why:** Drizzle's schema push refuses an automatic text-to-integer cast instead of silently risking data loss or an invalid migration.

**How to apply:** Preserve the stored format at the database boundary and validate/convert it in application code or plan a separately reviewed migration.

Neon production can lag the current Drizzle model even when the local schema and code are already aligned. Collection routes using `select().from(table)` then fail with PostgreSQL 42703 on the first missing column; compare every ORM column in the full service/check path before testing only one field.

**Why:** The public catalog loaded all service and check columns, so an apparently fixed `response_mode` mismatch still left newer service metadata and `security_signals` absent in production.

**How to apply:** Treat additive production schema synchronization as one idempotent, non-destructive operation, backfill historical timestamps from existing creation timestamps, and add a local required-column regression test alongside the route test.

The security observation flow depends on two separate tables in addition to the service/check tables: observations link to services with cascade deletion, while threat indicators are independent records with only their primary key.

**Why:** Production had the service and check tables but neither security table, so a live check failed only when `saveOutcome` tried to read the previous observation.

**How to apply:** Compare table existence as well as columns, primary-key indexes, and foreign keys; verify the full authenticated check path, not only catalog reads.