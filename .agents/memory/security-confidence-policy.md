---
name: Security confidence policy
description: Durable rules for interpreting Bond402 security observations and trust scores.
---

Bond402 must present availability, Security Confidence, and overall Trust as separate observations. Unknown reputation, insufficient samples, or unevaluated signals must remain visible and must cap confidence rather than being silently treated as a pass.

**Why:** Reachability and historical uptime do not establish security, and a single successful response cannot justify a high-confidence safety claim.

**How to apply:** Keep unknown or warning-level confidence visible and conservative. For an owner-bound, verified, non-mutating GET/HEAD flow, surface that state as CAUTION without treating it as a hard execution block; BLOCK, missing auth, missing parameters, and insufficient verification remain hard stops. Preserve explicit statements that observations are not a security guarantee.