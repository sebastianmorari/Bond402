# Bond402 Public Beta

## Public agent flow

Bond402 exposes an operator-approved catalog, not a universal search engine for the internet.
Only services whose owner explicitly selects **Gelistet** appear publicly.

1. Read `/.well-known/bond402-agent.json` or `/api/public/discovery`.
2. Search `/api/public/services?q=...&page=1&pageSize=20`.
3. Read `/api/public/services/{id}`.
4. Read the stored decision from `/api/public/services/{id}/pre-action-check`.
5. For an explicit action context, POST `{"actionContext":"READ"}`, `WRITE`, `PAYMENT`, or
   `CREDENTIAL_USE` to the same pre-action endpoint.

The public result uses the stable decisions `ALLOW`, `CAUTION`, and `BLOCK` and includes
freshness, policy version, reasons, and access/usage metadata. It does not trigger a live
check and does not consume the listed owner's monthly product quota.

## Visibility and privacy

New services are private by default. The owner can switch a service between **Privat** and
**Gelistet** in the service configuration. Unpublishing switches it back to private; deleting
the service removes its checks as before.

Public responses contain only the service ID, name, URL, listed timestamp, Trust Score,
latest public check summary, and machine-readable links. They never contain owner IDs,
account details, sessions, API-key values or hashes, or internal check details.

## Limits and key model

Public catalog, detail, discovery and stored pre-action requests share a limit of 60 requests
per minute per IP. A `429` response includes `Retry-After`.

The public-beta Developer API key model is owner-bound. It supports create-and-revoke
rotation, but not cross-account delegation, selectable scopes or expiration dates yet.
Live checks, owner changes and quota-counted Developer pre-action checks still require the
owner's Bearer API key.

`ALLOW` is not a security guarantee. Agents must apply their own domain, authorization,
data-protection and business-policy checks before acting.