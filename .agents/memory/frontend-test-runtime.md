---
name: Bond402 frontend test runtime
description: Runtime requirements for the local SPA smoke test
---

The Bond402 Vite app intentionally requires both `PORT` and `BASE_PATH` at startup.
The local frontend smoke test must provide both values and terminate the detached
Vite process group after the test.

**Why:** The artifact is path-routed in Replit/Vercel, so a missing base path is a
configuration error rather than something the app should silently guess. A plain
child-process kill can leave the Vite descendant running and make CI time out.

**How to apply:** When changing the frontend smoke harness or running the app outside
the managed workflow, set `BASE_PATH` explicitly and verify the test process exits.