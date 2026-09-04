---
name: Dependency removal and lockfile sync
description: Removing workspace packages may require an explicit manifest and lockfile synchronization.
---

Dependency removals and security overrides should be verified in each affected package.json, pnpm-workspace.yaml, and pnpm-lock.yaml; if the package-management helper targets the workspace root instead of a child package, edit the workspace manifest explicitly and synchronize the lockfile.

**Why:** A stale importer or package snapshot can keep removed integrations or vulnerable transitive versions in the dependency graph even when source imports are gone.

**How to apply:** After removing or overriding a dependency, search source, manifests, and the lockfile, then run the workspace lockfile-only sync and install before the final typecheck/build.