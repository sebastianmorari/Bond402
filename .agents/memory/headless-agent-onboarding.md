---
name: Headless agent onboarding
description: The API-only path from public discovery to owner-bound Developer checks and its non-persistent external-detail boundary.
---

The headless onboarding contract is exposed by `/api/public/agent-onboarding` and is also linked from the runtime public OpenAPI document. It deliberately separates public discovery/preflight from verified owner bootstrap: email verification, an HttpOnly session, owner service registration, one-time Developer API-key creation, and quota/rate-limited live checks.

Direct OpenAPI discovery results remain `UNVERIFIED_EXTERNAL` and are not persisted into the public catalog. A bounded in-memory TTL detail cache lets the same direct result be retrieved for immediate detail and safe external preflight requests without changing the public catalog policy.

**Why:** Agents need a deterministic, dashboard-free sequence and a follow-up reference after direct discovery, while external metadata must not become trusted or durable merely because a URL was probed.

**How to apply:** Keep public steps read-only and secret-free; require the verified owner session before service/key mutations; send Developer secrets only as bearer authorization; treat `ALLOW`/`READY` as observations or workflow states rather than guarantees.