---
name: Local browser E2E contract
description: Local Playwright coverage uses API fixtures and needs a browser path that CI must provide explicitly.
---

The Bond402 browser E2E flow must mock every dashboard list endpoint with the
correct collection shape, not just the primary service and auth routes. The
local runner uses `playwright-core` with an existing Chromium binary; CI needs
to provide its own managed binary through `BOND402_CHROMIUM_PATH` or an
equivalent runner path.

**Why:** The dashboard mounts several independent queries during login. A
missing array response causes a UI error boundary before the intended flow is
exercised, and Replit's Chromium path is not portable to GitHub runners.

**How to apply:** Keep browser fixtures synthetic and secret-free, cover
desktop/mobile assertions locally, and treat CI browser installation as a
separate launch blocker rather than silently skipping the E2E test.