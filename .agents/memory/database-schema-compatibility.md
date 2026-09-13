---
name: Database schema compatibility
description: Avoid unsafe automatic type changes when synchronizing the development schema.
---

When a development table already exists with a compatible textual representation, do not change that column to a numeric PostgreSQL type through a normal Drizzle push; use the existing representation unless an explicit migration with a safe cast is requested.

**Why:** Drizzle's schema push refuses an automatic text-to-integer cast instead of silently risking data loss or an invalid migration.

**How to apply:** Preserve the stored format at the database boundary and validate/convert it in application code or plan a separately reviewed migration.