---
name: Developer API ingress
description: Why Bond402 trusts exactly one proxy hop when deriving client IPs for pre-authentication rate limits.
---

Bond402's pre-authentication IP limits assume the deployed API is behind exactly one trusted Replit ingress proxy. Keep Express proxy trust restricted to one hop unless the real deployment topology is verified to differ.

**Why:** Without proxy trust, all clients appear to share the proxy's socket address and one caller can exhaust the global bucket. Trusting arbitrary proxy chains would instead allow forged forwarding headers.

**How to apply:** When changing deployment routing or adding another proxy/CDN, verify the forwarding chain and update the trust setting and rate-limit tests together.