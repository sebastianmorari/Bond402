---
name: Security confidence policy
description: Durable rules for interpreting Bond402 security observations and trust scores.
---

Bond402 must present availability, Security Confidence, and overall Trust as separate observations. Unknown reputation, insufficient samples, or unevaluated signals must remain visible and must cap confidence rather than being silently treated as a pass.

**Why:** Reachability and historical uptime do not establish security, and a single successful response cannot justify a high-confidence safety claim.

**How to apply:** Keep pre-action decisions conservative when the latest security confidence is unknown or warning-level; preserve explicit statements that observations are not a security guarantee; do not introduce reputation providers or external execution without a deliberate, separately reviewed decision.