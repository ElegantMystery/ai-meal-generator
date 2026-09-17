# Grocery Concierge Implementation Plan

**Goal:** Implement the approved signed-in dashboard in issue #75.
**Spec:** https://github.com/ElegantMystery/ai-meal-generator/issues/75
**Architecture:** Keep generation and recovery orchestration in the dashboard. Extract defensive preview/date helpers and presentational dashboard components. Reuse the shared JSON parser and design-system components.
**Tech stack:** Next.js, React, Tailwind, Heroicons, Jest/Testing Library.

## Constraints and dependency

- Preserve the landing page, authentication, quota, SSE, durable recovery, and existing routes.
- Store/duration/servings controls remain labeled; servings remain 1–12.
- Issue #71 merged; integration is based on main at `282cf7e`.
- Do not merge this PR or close #75.
- Saved plan responses do not preserve diner counts; dish calorie scope is unspecified. Omit ambiguous estimates rather than divide by the current composer setting. Show the saved per-person daily target.

## Tasks

- [x] Add tests for newest currently covering plan, latest fallback, actual-day selection, invalid dates, malformed nested JSON and legacy items. Implement `frontend/lib/dashboard-plan-utils.ts`, reusing `safeParsePlanJson` without changing detail-page semantics.
- [x] Add component tests before implementing preference loading/error/unset summaries, compact composer, featured day navigation and responsive history cards in `frontend/components/dashboard/`. Preserve unavailable plans and explicit dates. Initially show four history cards with an accessible expand action.
- [x] After #71 merges or ownership is agreed, integrate components into `frontend/app/dashboard/page.tsx`; preserve the generation/recovery callbacks and regressions. Fetch only the featured shopping summary, cancel stale requests, distinguish loading/failure from zero cost.
- [ ] Run frontend tests/lint/build and applicable repository checks; capture desktop/mobile empty and returning screenshots, inspect tablet and keyboard behavior. Review correctness/security/performance, fix material findings, and submit a PR linked to #75 with CI green. Leave both open.

## Handoff status

Integration is complete. Frontend tests (253), lint, production build, repository-policy/documentation and deployment-control checks pass. Independent review found no significant issues. Browser checks and screenshots cover empty and returning accounts at 375, 768 and 1440 px, including keyboard day navigation, composer value retention, full history access and no horizontal overflow. Full service CI will run on the PR. The PR and issue remain open for Scrum Master validation.
