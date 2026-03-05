/**
 * Dish-centric meal plan utilities.
 *
 * Provides shared types, a safe JSON parser, and pure helper functions
 * used by the meal plan detail page when rendering dish-centric plans.
 *
 * Backward compatible: old plans (flat items, no dishes key) continue to work.
 */

export type PlanItem = {
  id: number;
  name: string;
  servingsUsed?: number;
};

export type PlanDish = {
  dishName: string;
  description?: string;
  estimatedCalories?: number;
  items: PlanItem[];
};

export type PlanMeal = {
  name: string;
  dishes?: PlanDish[];
  items: PlanItem[];
};

export type PlanDay = {
  date: string;
  meals: PlanMeal[];
};

export type PlanDoc = {
  title?: string;
  startDate?: string;
  endDate?: string;
  plan: PlanDay[];
};

// ---------------------------------------------------------------------------
// safeParsePlanJson
// ---------------------------------------------------------------------------

export function safeParsePlanJson(planJson: string | null): {
  doc: PlanDoc | null;
  error?: string;
} {
  if (!planJson) return { doc: null };
  try {
    const parsed = JSON.parse(planJson);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.plan)) {
      return { doc: null, error: "Plan JSON has unexpected shape." };
    }
    return { doc: parsed as PlanDoc };
  } catch {
    return { doc: null, error: "Plan JSON is not valid JSON." };
  }
}

// ---------------------------------------------------------------------------
// hasDishes — true when a meal uses the dish-centric format
// ---------------------------------------------------------------------------

export function hasDishes(meal: {
  dishes?: PlanDish[] | null;
  items: PlanItem[];
}): boolean {
  return Array.isArray(meal.dishes) && meal.dishes.length > 0;
}

// ---------------------------------------------------------------------------
// getDishItemLabel — chip label with optional "Nx " prefix
//
// Rules:
//   n < 1  (pantry staples, e.g. 0.1 servings of olive oil): show just name
//   n === 1 (single serving): show just name
//   n > 1   (multiple servings): show "<n>x Name"
//             - Number formatted via JS string coercion: trailing zeros stripped
//               automatically (2.0 → "2", 1.50 → "1.5")
// ---------------------------------------------------------------------------

export function getDishItemLabel(item: PlanItem): string {
  const n = item.servingsUsed ?? 1;
  if (n > 1) {
    // Strip trailing zeros by relying on JS number-to-string coercion.
    // e.g. 2.0 → "2", 1.5 → "1.5", 2.50 → "2.5"
    const label = String(parseFloat(n.toPrecision(10)));
    return `${label}x ${item.name}`;
  }
  return item.name;
}
