# Issue 92 Preferences visual review

The user approved the proposed layout before implementation: Preferences heading and Back to Home link; compact account card beside a larger preference form on desktop; stacked cards on mobile; Save preferences at the bottom, full-width on mobile.

Captured from a production frontend build in Chromium using synthetic account and preference API responses. No private account data, live generation, or production writes were used.

| State | Mobile (375 px) | Desktop (1440 px) |
| --- | --- | --- |
| Loaded | [Mobile](ready-375.png) | [Desktop](ready-1440.png) |
| Loading | [Mobile](loading-375.png) | [Desktop](loading-1440.png) |
| Load failed | [Mobile](load-error-375.png) | [Desktop](load-error-1440.png) |
| Save failed | [Mobile](save-error-375.png) | [Desktop](save-error-1440.png) |

[Tablet, 768 px](ready-768.png).

Verified no horizontal overflow or browser errors in these states. Keyboard checks cover moving from dietary style to an allergy removal button, removing a tag with Enter, and adding it back through the input. Long names, emails and allergy tags fit at 375 px. Failed-save captures retain the edited 1800 calorie target; failed-load captures do not expose empty editable fields and disable Save. The loading state also disables Save.

Local checks: 273 frontend tests, lint, production build, documentation checks/tests, immutable CI references, PR-workflow tests, deployment-control checks, and diff whitespace checks pass. Independent code review found no actionable regressions. Full PR CI must pass before coordinator merge.

Existing dietary values, semicolon-delimited allergy persistence, optional calorie target, authenticated API client and CSRF flow are retained. Successful saves invalidate Home's preference summary. Direct visits load account details independently; account failures do not masquerade as missing profile values. Shared allergy-input changes are limited to label wiring, brand styling, keyboard/touch accessibility and overflow handling; the onboarding API remains compatible.
