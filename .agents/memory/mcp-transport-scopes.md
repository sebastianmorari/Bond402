---
name: MCP transport boundary
description: Durable design rules for the Bond402 MCP endpoint and Developer API-key scopes.
---

Bond402 MCP is a stateless Streamable HTTP adapter. It may validate JSON-RPC,
protocol metadata, tool arguments, Origin, authentication and scopes, but it
must not create a second discovery, trust, planning, execution, quota or audit
implementation.

**Why:** The safety properties of Bond402 live in the existing owner-bound
catalog, verification, PLAN→EXECUTE, quota, SSRF/redirect and execution-audit
paths. Duplicating any of them in MCP would create two policy boundaries that
could drift.

**How to apply:** Public MCP tools remain read-only and owner-free. Private
tools are exposed only when the existing revocable Developer API key carries
the required `read`, `plan`, `execute` or `audit` scope. OAuth 2.1/PKCE is not
claimed unless a complete, testable free authorization-server flow exists.