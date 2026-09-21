---
name: Large SQL test fixtures
description: PostgreSQL fixture scripts can exceed the shell argument limit when passed through psql -c.
---

Large PostgreSQL fixture statements should be sent to `psql` through stdin rather than as a `-c` argument.

**Why:** Execution-gateway fixtures can contain many repeated JSON observations and exceed the operating system argument-size limit, causing an `E2BIG` test failure before the application is exercised.

**How to apply:** Keep `psql` command arguments small and use a piped/stdin SQL script for large integration-test setup and cleanup.