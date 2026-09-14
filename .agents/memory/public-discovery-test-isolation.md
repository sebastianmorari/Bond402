---
name: Public discovery test isolation
description: How public catalog tests stay deterministic when external discovery is persisted.
---

Public catalog and external-discovery tests must use unique, low-collision query tokens and clean their fixture URLs/source rows. Persisted external metadata is intentionally retained across catalog reads, so tests that use common words can accidentally become internal-primary or return old records.

**Why:** The production behavior deliberately persists public discovery metadata and hides only stale records; assuming an empty catalog between tests makes fallback and security-gate tests order-dependent.

**How to apply:** Use a per-run token that does not include common words such as public, route, fixture, or external, and remove the exact fixture canonical URL/source rows in setup and teardown.