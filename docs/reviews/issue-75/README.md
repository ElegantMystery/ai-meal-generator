# Issue 75 visual review

Production frontend screenshots use synthetic account, preference and saved-plan API fixtures; no private account data or paid generation calls were used. Captured 2026-09-17 in Chromium at 375, 768 and 1440 px. The public landing page is unchanged.

| Account | Mobile | Tablet | Desktop |
| --- | --- | --- | --- |
| Empty | [375 px](empty-375.png) | [768 px](empty-768.png) | [1440 px](empty-1440.png) |
| Returning | [375 px](returning-375.png) | [768 px](returning-768.png) | [1440 px](returning-1440.png) |

Browser checks: no horizontal overflow or page errors at all six configurations; returning composer preserves servings across close/reopen; all saved history is accessible; day buttons support keyboard activation and expose selected state. Layouts were visually inspected at mobile and desktop sizes.

Saved dish calorie estimates do not have reliable serving-scope metadata: the plan response lacks diner count and the generation contract does not explicitly scope estimatedCalories. The dashboard therefore shows the saved per-person daily target and omits ambiguous calorie estimates. Shopping estimates are explicitly for the full plan.
