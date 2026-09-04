---
name: Dependency removal and lockfile sync
description: Removing workspace packages may require an explicit manifest and lockfile synchronization.
---

Dependency removals should be verified in both each affected package.json and pnpm-lock.yaml; if the package-management helper reports success without changing the workspace files, synchronize the lockfile before building.

**Why:** A stale importer or package snapshot can keep removed integrations in the dependency graph even when source imports are gone.

**How to apply:** After removing a dependency, search source, manifests, and the lockfile, then run the workspace lockfile-only sync before the final typecheck/build.