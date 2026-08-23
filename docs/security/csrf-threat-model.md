# Cookie session and CSRF threat model

The browser authenticates with a host-only `JSESSIONID` cookie. In production it
is `Secure`, `HttpOnly`, `SameSite=Lax`, and expires after 12 hours; the server
session has the same timeout. No cookie domain is configured, so sibling
subdomains cannot receive it.

All cookie-authenticated mutations require the double-submit CSRF token from
`XSRF-TOKEN` in the `X-XSRF-TOKEN` header. The frontend obtains the token from
`GET /api/auth/csrf`; Axios attaches it to POST/PUT/DELETE requests and the
handwritten SSE client attaches it to AI-generation POSTs. CORS admits
credentials only from the configured frontend origins.

## State-changing endpoints

| Endpoint | State changed | Protection |
|---|---|---|
| `POST /api/auth/complete-onboarding` | User onboarding state | Session auth + CSRF |
| `POST /api/auth/logout` and `/logout` | Browser session | Session auth + CSRF |
| `POST /api/mealplans` | Saved plans | Session auth + CSRF |
| `DELETE /api/mealplans/{id}` | Saved plans | Session auth + CSRF |
| `POST /api/mealplans/generate` | Plan, quota | Session auth + CSRF |
| `POST /api/mealplans/generate-ai` | Generation, plan, quota | Session auth + CSRF + idempotency |
| `PUT /api/preferences/me` | Preferences | Session auth + CSRF |
| `POST /api/subscription/checkout` | Stripe checkout session | Session auth + CSRF |
| `POST /api/subscription/portal` | Stripe portal session | Session auth + CSRF |
| `POST /api/items` | Catalog item | Session auth + CSRF |
| `POST /api/webhooks/stripe` | Subscription state | No browser CSRF; Stripe signature verification and event idempotency |

The Stripe webhook is the only CSRF exemption because it is a server-to-server
request without a browser session. Removing signature verification is not an
acceptable substitute for CSRF protection.
