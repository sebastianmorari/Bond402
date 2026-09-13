---
name: Workspace server-test runner
description: Environment-specific runner requirement for server-side TypeScript tests.
---

Server-side tests that import API source files with extensionless TypeScript imports must be invoked through the workspace `tsx` runner, not directly with Node.

**Why:** Direct Node execution cannot resolve those source imports in this PNPM workspace, while the existing scripts package runner resolves them correctly.

**How to apply:** Use the same `pnpm --filter @workspace/scripts exec tsx --test ...` pattern for new server-side regression tests and package scripts.