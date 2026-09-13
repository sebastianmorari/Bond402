---
name: External OpenAPI probing
description: Conservative rules for reading third-party API specifications without turning discovery into an active scan.
---

External OpenAPI discovery is passive metadata collection. Declared servers and endpoints, including paths with variables, may be shown as source observations, but variable values, credentials, and missing auth requirements must never be invented.

**Why:** Third-party specifications frequently contain templated paths and incomplete security declarations. Treating those as callable public endpoints would create false confidence and could send unintended requests.

**How to apply:** Only offer an external endpoint for the existing Bond402 check when the specification explicitly permits no security, the method is GET or HEAD, the URL is HTTPS and public, and no path or required parameter needs a guessed value. Keep the result `UNVERIFIED_EXTERNAL` until Bond402 performs its own owner-controlled check.

The public catalog must never synchronously wait for a cold external discovery cache. Return the bounded internal result first, then warm external metadata in the background under the existing timeout and response-size limits; only use cached external records on a later request.

**Why:** The APIs.guru directory is large and a cold fetch can make an otherwise fast internal catalog request approach or exceed upstream request timeouts.

**How to apply:** Keep the internal database query as the primary response path. Treat an empty external cache as `UNAVAILABLE` for the current request, deduplicate background refreshes, and preserve explicit external source/verification metadata when cached results are eventually served.