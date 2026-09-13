---
name: Auth mail launch configuration
description: The deployment-dependent rule for enabling Bond402 verification and password-reset links.
---

Production auth-mail links must use the real published HTTPS URL returned by the deployment service; never derive or guess a production domain from development environment variables.

**Why:** The project can be tested locally with a mock Resend endpoint, but a guessed base URL would send users to a non-working or wrong host. The API intentionally rejects non-HTTPS bases in production.

**How to apply:** After publishing, set `PUBLIC_BASE_URL` to the deployment service's `primaryUrl`, verify the Resend sender, and run the auth-mail production smoke flow. Keep `RESEND_API_URL` overrides limited to isolated tests.

In Development, when `PUBLIC_BASE_URL` is absent, auth routes may use the current request origin only to make local/preview verification and reset flows testable; this fallback must never replace the production setting.

**Why:** The development workflow does not have a stable published URL, but valid registration should still reach the mail provider instead of failing before delivery configuration is attempted.

**How to apply:** Keep the fallback request-scoped and disabled in production. Do not persist or promote a local request origin into `PUBLIC_BASE_URL`.