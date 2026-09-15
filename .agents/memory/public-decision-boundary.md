---
name: Public decision boundary
description: How public Decision availability relates to service security-status transitions.
---

The public headless Decision API must use the same public catalog boundary as other anonymous catalog reads: only listed services with `VERIFIED_LOW_RISK` are internal candidates. A first owner-bound live check can move a service to `SANDBOXED_OBSERVED` until enough qualifying observations exist, so it may temporarily disappear from anonymous Decision results.

**Why:** This keeps anonymous decisions aligned with the existing first-seen security gate and prevents a live observation from being mistaken for completed verification.

**How to apply:** In tests and onboarding flows, verify the public Decision before the first live check when asserting the service is an internal public candidate; after the check, expect the existing public-status transition unless the service has requalified.