---
name: OAuth resource and consent boundaries
description: Bond402 OAuth tokens are limited to the MCP resource and owner consent uses a short-lived server transaction with CSRF proof.
---

OAuth access and refresh tokens must remain audience-bound to the canonical `/mcp` resource; the MCP bearer verifier rejects tokens issued for another resource or a revoked client. Authorization approval must consume a short-lived server-side transaction and require a session-bound CSRF proof rather than trusting hidden OAuth request fields.

**Why:** Bond402 exposes public discovery alongside owner-scoped planning and execution. Resource binding prevents a token minted for one protected resource from becoming a general credential, and server-side consent binding prevents cross-site approval of attacker-controlled authorization parameters.

**How to apply:** Preserve the `read`, `plan`, `execute`, `audit`, and `offline_access` scope mapping, keep OAuth principals owner-bound through the existing MCP plan/execution paths, and treat Developer-Key authentication as a separate compatibility path.