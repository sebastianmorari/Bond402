---
name: Resilient collection responses
description: Durable rule for aggregating stored records without letting one malformed item break the whole response.
---

Collection endpoints and their owner-facing renderers must validate each item independently. A malformed parent record should be skipped, while a malformed child record should be removed when the parent can still be represented safely; valid records must remain available.

**Why:** Historical or manually altered data can violate current response schemas long after it was stored. Failing the entire collection hides healthy data and makes one bad record look like a system-wide outage; an unguarded client renderer can turn the same bad item into a generic full-page crash even when the API itself is reachable.

**How to apply:** Keep internal validation details in server logs with a request identifier, parent identifier, and concrete field paths. Return only schema-valid records and never expose raw database values or validation internals to clients.