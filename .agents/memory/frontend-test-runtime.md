---
name: Bond402 frontend test runtime
description: Runtime requirements for the local SPA smoke test
---

The Bond402 and Mockup Sandbox Vite apps accept explicit `PORT` and `BASE_PATH`
values from managed workflows, production builds, and tests, but use safe local
defaults when those variables are omitted. The local frontend smoke test should
still provide both values explicitly and terminate the detached Vite process group.

**Why:** Replit/Vercel and test harnesses need deterministic path/port values, while
a plain local build should not fail before Vite can build. A plain child-process kill
can also leave the Vite descendant running and make CI time out.

**How to apply:** Keep explicit values in managed workflows, `vercel.json`, and test
harnesses. For an unconfigured local invocation, Bond402 defaults to `PORT=4173` and
Mockup Sandbox to `PORT=4174`; both default to `BASE_PATH=/`.