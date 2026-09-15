---
name: OpenAPI Zod codegen
description: Compatibility rule for generated Zod validators in the shared OpenAPI libraries.
---

The current OpenAPI generator emits `zod.url()` for URI-formatted strings, but the workspace's installed Zod version exposes URL validation as `zod.string().url()`.

**Why:** A successful code-generation run can still fail the library build immediately when the generated validator uses the newer API shape.

**How to apply:** After OpenAPI codegen, restore the generated API import to the local compatibility module, remove the duplicate body export from the generated type index, then run the workspace typecheck. Keep the correction limited to generated output; do not weaken URI validation.

The generator also emits a duplicate `DiscoverOpenApiFromExplicitUrlBody` export in both the generated API module and type barrel, so codegen currently requires this same post-generation cleanup.

**Why:** These are generator/workspace compatibility issues, not API-contract errors; leaving either one unresolved blocks all library consumers after an otherwise successful codegen run.