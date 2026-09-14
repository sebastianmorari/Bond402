---
name: CI secret scan fixtures
description: A workspace-specific false positive when test-only CI database fields resemble credentials.
---

The tracked-secret scan treats test-only CI environment names such as `POSTGRES_PASSWORD` as high-confidence secret patterns even when the value is non-production and visible by design. Use an isolated PostgreSQL service with trust authentication for CI fixtures instead of adding password-shaped fields.

**Why:** The launch gate must remain secret-free, and the scanner intentionally errs on the side of flagging credential-shaped configuration.

**How to apply:** When adding local or CI database fixtures, keep credentials out of tracked files and use a disposable trust-authenticated database or the workspace secret flow for real credentials.