---
name: Developer API scope enforcement
description: Keep Developer API permissions distinct from rate-limit buckets and enforce the required scope on every protected action.
---

Every authenticated Developer API request must check the key's required capability after authentication. A rate-limit category such as read/check is not a permission decision.

**Why:** A valid key can otherwise reach provider-calling PLAN/EXECUTE paths regardless of the scopes shown in the owner UI. Legacy keys remain compatible by receiving the historical full-scope default when the stored scope field is absent.

**How to apply:** Map read, plan, execute, and audit explicitly at each REST and MCP entrypoint; return a safe 403 `SCOPE_REQUIRED` response without exposing database or stack details.