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
// getDishItemLabel — chip label with optional "Nx " prefix for servingsUsed > 1
// ---------------------------------------------------------------------------

export function getDishItemLabel(item: PlanItem): string {
  const n = item.servingsUsed ?? 1;
  if (n > 1) {
    return `${n}x ${item.name}`;
  }
  return item.name;
}
