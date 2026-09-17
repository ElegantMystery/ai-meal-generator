import { safeParsePlanJson } from '@/lib/mealplan-dish-utils';

export type SavedPlan = {
  id: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
  planJson: string | null;
};
export type PreviewMeal = {
  name: string;
  dishes: { name: string; description?: string }[];
  itemNames: string[];
};
export type PreviewDay = { date: string; meals: PreviewMeal[] };

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function sortedPlans(plans: SavedPlan[]): SavedPlan[] {
  const timestamp = (plan: SavedPlan) => {
    const value = Date.parse(plan.createdAt ?? '');
    return Number.isFinite(value) ? value : -Infinity;
  };
  return [...plans].sort((a, b) => timestamp(b) - timestamp(a));
}

export function featuredPlan(plans: SavedPlan[], today: string): SavedPlan | null {
  const sorted = sortedPlans(plans);
  return sorted.find(plan => validDate(plan.startDate) && validDate(plan.endDate) && plan.startDate <= today && today <= plan.endDate) ?? sorted[0] ?? null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** The shared parser checks the envelope; nested legacy data still needs guards. */
export function previewDays(json: string | null): PreviewDay[] {
  const { doc } = safeParsePlanJson(json);
  if (!doc) return [];
  return doc.plan.flatMap(raw => {
    const day = record(raw);
    if (!day || !validDate(day.date)) return [];
    const meals: PreviewMeal[] = (Array.isArray(day.meals) ? day.meals : []).flatMap(rawMeal => {
      const meal = record(rawMeal);
      if (!meal || !text(meal.name)) return [];
      const dishes = (Array.isArray(meal.dishes) ? meal.dishes : []).flatMap(rawDish => {
        const dish = record(rawDish);
        const name = text(dish?.dishName);
        if (!name) return [];
        // Saved plans do not establish calorie serving scope. Do not invent one.
        return [{ name, description: text(dish?.description) }];
      });
      const itemNames = (Array.isArray(meal.items) ? meal.items : []).flatMap(item => {
        const name = text(record(item)?.name);
        return name ? [name] : [];
      });
      return [{ name: meal.name as string, dishes, itemNames }];
    });
    return [{ date: day.date, meals }];
  });
}

export function initialDayIndex(days: PreviewDay[], today: string): number {
  return Math.max(0, days.findIndex(day => day.date === today));
}
