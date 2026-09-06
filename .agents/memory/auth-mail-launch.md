---
name: Auth mail launch configuration
description: The deployment-dependent rule for enabling Bond402 verification and password-reset links.
---

Production auth-mail links must use the real published HTTPS URL returned by the deployment service; never derive or guess a production domain from development environment variables.

**Why:** The project can be tested locally with a mock Resend endpoint, but a guessed base URL would send users to a non-working or wrong host. The API intentionally rejects non-HTTPS bases in production.

**How to apply:** After publishing, set `PUBLIC_BASE_URL` to the deployment service's `primaryUrl`, verify the Resend sender, and run the auth-mail production smoke flow. Keep `RESEND_API_URL` overrides limited to isolated tests.