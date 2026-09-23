---
name: MCP protocol version negotiation
description: The distinction between current and legacy MCP initialize validation.
---

The first entry in the supported MCP protocol-version list is the current version. Initialize validation must require protocolVersion, capabilities, and clientInfo for every supported version, while allowing standard optional metadata and forward-compatible extension fields for legacy versions too.

**Why:** MCP clients such as ChatGPT can negotiate an older supported version and still send standard _meta or namespaced extension fields; rejecting those fields prevents OAuth-authenticated tools/list discovery.

**How to apply:** Keep the current-version branch aligned with the existing supported-version list, strictly validate the three required core fields, accept optional metadata/extensions, and verify legacy initialize plus authenticated tools/list.