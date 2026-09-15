---
name: Execution gateway safety
description: Durable security rules for Bond402's agent-native PLAN/EXECUTE gateway.
---

The execution gateway must remain a two-step flow: a short-lived PLAN is bound to the owner, Developer API key, registered service operation, normalized parameter digest, and service-configuration digest; EXECUTE atomically claims that plan before consuming quota or contacting a provider.

**Why:** This prevents anonymous proxying, replay-driven quota consumption, and configuration drift between readiness and the provider request.

**How to apply:** Keep executable methods limited to registered HTTPS GET/HEAD operations, use the existing outbound safety gateway, obtain credentials only from encrypted server-side service configuration, reject undeclared or mistyped parameters, return provider data only through a total byte-bounded redaction pass, and write digest-only audit records for successful and rejected execution attempts.