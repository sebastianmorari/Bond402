---
name: Public beta catalog
description: Durable visibility, privacy, and agent-access decisions for Bond402's public beta.
---

Only services explicitly marked listed are exposed to the public catalog. New services are
private by default, and unpublishing must make detail and pre-action routes return not found.

**Why:** The catalog is an operator-approved directory rather than a universal internet search
engine, and public responses must not reveal account, owner, key, session, or internal-check data.

Public pre-action reads stored checks without running a live check or consuming monthly product
quota. Owner-bound Developer API keys remain required for live checks, owner changes, and
quota-counted privileged operations. The beta key model intentionally has no scopes, delegation,
or expiry; rotation is create-new then revoke-old.

**How to apply:** Keep public endpoints read-only, rate-limited, and limited to listed service
metadata. Keep privileged owner routes owner-bound even when adding new agent-facing discovery.