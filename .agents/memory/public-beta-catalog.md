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

Public customer messaging should lead with discovery, trust metadata, live checks, and
pre-action signals. Public-Beta plans are manually activated for pilots; there is no fixed
beta end date, and x402/Bond/TEST-CREDITS/TEST-BONDS/reputation remain clearly labeled
experimental simulations.

**Why:** Self-service billing and live settlement are not part of the current production
capability, while pilot onboarding is the supported early-access path.

**How to apply:** Keep pricing UI informational, route pilot requests to support@bond402.com,
and state that the beta transition depends on pilot validation and later self-service billing.