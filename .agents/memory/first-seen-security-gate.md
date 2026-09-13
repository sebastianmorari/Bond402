---
name: First-seen security gate
description: Conservative quarantine and score-cap rules for newly observed services.
---

First-seen services must remain explicitly quarantined until multiple live observations exist. `SANDBOXED_OBSERVED`, `SUSPICIOUS`, and `FLAGGED` are separate from availability; threat indicators and historical drift cap or remove positive trust, while unknown reputation remains a confidence cap.

**Why:** One reachable response cannot establish reputation or safety, and a clean heuristic result is not a security guarantee.

**How to apply:** Keep quarantine state, security confidence, availability, and overall trust as separate fields in API responses and UI. Never promote a service from a single successful check.