---
name: Observed trust signals
description: Durable rules for presenting Bond402 TLS, headers, uptime, latency, and domain-verification data
---

Bond402 must present TLS, HTTPS, security-header, domain-verification, uptime, and latency results as observed signals with explicit states such as checked, warning, unavailable, or not evaluated. ALLOW and the Trust Score must never be described as a security guarantee, audit, certification, malware scan, vulnerability assessment, or external reputation.

**Why:** The product's public value depends on agents and operators being able to distinguish measured evidence from unknowns without overclaiming safety.

**How to apply:** Keep public API, pre-action responses, dashboard, service detail pages, legal copy, llms.txt, and metadata aligned whenever a new trust signal is added or its interpretation changes.