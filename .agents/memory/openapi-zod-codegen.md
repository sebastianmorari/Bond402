---
name: OpenAPI Zod codegen
description: Compatibility rule for generated Zod validators in the shared OpenAPI libraries.
---

The current OpenAPI generator emits `zod.url()` for URI-formatted strings, but the workspace's installed Zod version exposes URL validation as `zod.string().url()`.

**Why:** A successful code-generation run can still fail the library build immediately when the generated validator uses the newer API shape.

**How to apply:** After OpenAPI codegen, search generated Zod files for `zod.url()` and normalize those validators before running the workspace typecheck. Keep the correction limited to generated output; do not weaken URI validation.