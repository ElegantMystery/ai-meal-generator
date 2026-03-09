/**
 * Thin wrapper around window.location.assign for external redirects.
 * Extracted so it can be easily mocked in unit tests
 * (jsdom does not allow reassigning window.location directly).
 *
 * Validates that the URL is https:// and targets a known Stripe hostname
 * to prevent open-redirect abuse if the backend response is tampered with.
 */
const ALLOWED_STRIPE_HOSTS = new Set([
  "checkout.stripe.com",
  "billing.stripe.com",
  "stripe.com",
]);

export function navigateTo(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error("navigateTo: rejected malformed URL");
    return;
  }

  if (parsed.protocol !== "https:") {
    console.error("navigateTo: rejected non-https URL");
    return;
  }

  if (!ALLOWED_STRIPE_HOSTS.has(parsed.hostname)) {
    console.error("navigateTo: rejected URL with untrusted hostname:", parsed.hostname);
    return;
  }

  window.location.assign(url);
}
