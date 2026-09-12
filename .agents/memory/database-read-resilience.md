---
name: Database read resilience
description: The project boundary for transient database retries and DATABASE_UNAVAILABLE responses.
---

Only idempotent reads on the service-list and dashboard GET paths may use the bounded transient database retry. Writes must not be wrapped in that retry.

**Why:** A short connection interruption should not make the dashboard unavailable, while retrying writes could duplicate side effects and classifying ordinary SQL errors as service outages hides actionable defects.

**How to apply:** Keep the transient allowlist limited to connection exceptions and explicit availability codes. Keep request-ID logging and return `DATABASE_UNAVAILABLE` only after the bounded read retry is exhausted.