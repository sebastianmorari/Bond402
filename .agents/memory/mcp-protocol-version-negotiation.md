---
name: MCP protocol version negotiation
description: The distinction between current and legacy MCP initialize validation.
---

The first entry in the supported MCP protocol-version list is the current version. Standard initialize parameters for that version must be accepted without legacy-only metadata requirements; legacy parameter validation applies only to older supported versions.

**Why:** A missing or inverted current-version condition can turn valid MCP clients into HTTP 400 responses or fail typechecking while leaving legacy behavior apparently intact.

**How to apply:** When changing MCP negotiation, keep the current-version branch aligned with the existing supported-version list and verify both standard current requests and legacy requests.