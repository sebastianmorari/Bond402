# Bond402 MCP

Bond402 exposes a stateless Streamable HTTP MCP endpoint at `/mcp`.

## Authentication and scopes

The endpoint uses the existing revocable Bond402 Developer API keys. Send the
secret only as:

```http
Authorization: Bearer b402_...
```

Keys can be created in the Developer page with these scopes:

- `read`: owner-bound service details
- `plan`: create a PLAN response; never calls a provider
- `execute`: execute an unexpired, owner-bound, single-use READY plan
- `audit`: read owner-bound plan and execution audit metadata

Public read-only tools do not need a key, but public discovery never grants
owner access or execution access. Existing keys receive the safe compatibility
default of all four scopes. Revoke a key in the Developer page to block it
immediately.

## Protocol

POST every JSON-RPC request to `/mcp` with:

```http
Accept: application/json, text/event-stream
Content-Type: application/json
```

The endpoint accepts the current `2026-07-28` metadata/header contract and
legacy Streamable HTTP versions through `2025-03-26`. It is stateless: no
session identifier or stored conversation state is created. `initialize` and
`notifications/initialized` remain supported for legacy clients. The server
does not accept GET-based legacy SSE transport.

Current clients must send `MCP-Protocol-Version`, `MCP-Method`, and the
corresponding `_meta.io.modelcontextprotocol/protocolVersion`. A `tools/call`
also sends `MCP-Name`. Legacy clients use the normal `initialize`,
`tools/list`, and `tools/call` messages.

## Tools

The public tools are:

- `search_services(task)` — public, read-only candidate search
- `compare_or_decide(task)` — public, read-only deterministic Decision response

Authenticated tools are scope-filtered:

- `get_service_details(serviceId)` — `read`
- `plan_execution(task | serviceId, operation?, parameters?)` — `plan`
- `execute_plan(planId, parameters?)` — `execute`
- `get_execution_status(planId | requestId)` — `audit`

MCP does not contain a second discovery or execution implementation. The
private tools call the existing owner binding, verification, security
confidence, PLAN→EXECUTE, quota, parameter digest, SSRF/redirect protection,
single-use plan, and execution-audit code paths.

`execute_plan` returns the existing structured Bond402 execution response.
Audit reads contain status, provider HTTP status, retryability, quota usage and
digests/metadata only; provider response payloads and secrets are not stored or
returned by the audit tool.

## OAuth status

OAuth 2.1 authorization-server discovery, dynamic client registration, and
PKCE are not enabled in this free workspace. The endpoint therefore does not
claim OAuth compatibility. Remote clients must use a revocable, scope-limited
Bond402 Developer key and treat it as a bearer secret. Do not put keys in
prompts, URLs, logs, source control, or screenshots.