---
name: External OpenAPI probing
description: Conservative rules for reading third-party API specifications without turning discovery into an active scan.
---

External OpenAPI discovery is passive metadata collection. Declared servers and endpoints, including paths with variables, may be shown as source observations, but variable values, credentials, and missing auth requirements must never be invented.

**Why:** Third-party specifications frequently contain templated paths and incomplete security declarations. Treating those as callable public endpoints would create false confidence and could send unintended requests.

**How to apply:** Only offer an external endpoint for the existing Bond402 check when the specification explicitly permits no security, the method is GET or HEAD, the URL is HTTPS and public, and no path or required parameter needs a guessed value. Keep the result `UNVERIFIED_EXTERNAL` until Bond402 performs its own owner-controlled check.

When the external discovery fallback is selected and its cache is cold, await one bounded load of the free public catalogs before responding. Keep the internal catalog as the primary path, and return external results only as `UNVERIFIED_EXTERNAL`.

**Why:** A cold-cache external query previously returned an empty result even when the bounded free catalog load could provide a relevant discovery hit. The fallback is already rate-limited and each catalog loader has its own timeout, response-size limit, and single-flight cache.

**How to apply:** Do not wait for external catalogs when internal results are adequate. On the fallback path, await the existing loaders once, preserve source provenance, and never turn external metadata into trust or security claims.