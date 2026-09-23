# Issue 91 dashboard header review

Captured from the production frontend build in Chromium on 2026-09-22 using
synthetic PRO account, subscription, preference, and meal-plan responses. No
private account data or live billing/generation calls were used.

| Viewport | PRO dashboard header |
| --- | --- |
| Mobile, 375 px | [Screenshot](pro-header-375.png) |
| Desktop, 1440 px | [Screenshot](pro-header-1440.png) |

Both layouts were visually inspected. The redundant `PRO · Unlimited · Manage`
badge is absent without reserving empty header space. The account trigger remains
available for Plan & billing navigation. Automated tests retain FREE quota and
upgrade coverage, account-menu billing navigation, and pricing-page portal access.
