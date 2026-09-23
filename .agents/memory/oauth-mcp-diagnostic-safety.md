---
name: OAuth and MCP diagnostic safety
description: Safe production observability rules for Bond402 OAuth completion and MCP authentication.
---

OAuth and MCP troubleshooting must expose the failing stage without recording credential material. Diagnostic events may include the request ID, HTTP status, normalized error code, a short hash of the client or credential identifier, scope names, boolean redirect/PKCE/resource checks, and owner-binding status. They must not include authorization codes, verifiers, tokens, cookies, developer keys, raw authorization headers, or raw redirect URIs.

**Why:** ChatGPT connection failures can happen after consent and before MCP discovery, while production request logs must remain safe to retain and correlate.

**How to apply:** Keep observability separate from the authorization decision. When adding a new OAuth or MCP stage, add a deterministic redaction test and preserve exact resource, redirect, PKCE, scope, owner, quota, and SSRF validation.