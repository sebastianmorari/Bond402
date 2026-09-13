---
name: External OpenAPI probing
description: Conservative rules for reading third-party API specifications without turning discovery into an active scan.
---

External OpenAPI discovery is passive metadata collection. Declared servers and endpoints, including paths with variables, may be shown as source observations, but variable values, credentials, and missing auth requirements must never be invented.

**Why:** Third-party specifications frequently contain templated paths and incomplete security declarations. Treating those as callable public endpoints would create false confidence and could send unintended requests.

**How to apply:** Only offer an external endpoint for the existing Bond402 check when the specification explicitly permits no security, the method is GET or HEAD, the URL is HTTPS and public, and no path or required parameter needs a guessed value. Keep the result `UNVERIFIED_EXTERNAL` until Bond402 performs its own owner-controlled check.