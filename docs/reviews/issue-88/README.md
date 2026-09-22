# Issue 88 navigation review

Captured from the production frontend build in Chromium on 2026-09-22 using synthetic account/preferences responses. No private account data, checkout, billing portal, or live generation was used.

| Width | Closed | Open |
| --- | --- | --- |
| Mobile, 375 px | [Closed](closed-375.png) | [Open](open-375.png) |
| Tablet, 768 px | [Closed](closed-768.png) | [Open](open-768.png) |
| Desktop, 1440 px | [Closed](closed-1440.png) | [Open](open-1440.png) |

Verified in Chromium at all three widths: the menu stays inside the viewport; trigger and entries are at least 44 px high; Enter opens; Tab visits Preferences, Plan & billing, then Sign out; Escape dismisses and restores trigger focus; pointer interaction outside and Tab out dismiss without trapping focus. Missing and long names were checked at 375 px; no email appears in the header. Desktop/mobile screenshots were visually inspected.

The dropdown is a disclosure with ordinary links/buttons, not an ARIA menu requiring arrow-key navigation. Plan & billing always links to the existing pricing page, including for PRO and unknown subscription states. Logout retains the existing authenticated callback and adds a pending guard against duplicate invocation. The public landing page and pricing/settings contents are unchanged.

Local verification: 262 frontend tests, lint, production build, documentation contract/tests, immutable-reference check, PR-workflow tests and deployment-control tests pass. Independent review found no actionable issues. All five PR CI jobs must pass before coordinator merge.
