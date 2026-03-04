/**
 * Tests for dish-centric meal plan utilities.
 *
 * TDD: Written FIRST (RED), then implementation added (GREEN).
 *
 * These tests cover:
 * 1. Type definitions — PlanItem.servingsUsed optional, PlanDish, updated PlanMeal
 * 2. safeParsePlanJson — accepts dish-centric JSON, backward compat with flat items
 * 3. Dish rendering logic helpers
 */

import {
  safeParsePlanJson,
  hasDishes,
  getDishItemLabel,
} from "@/lib/mealplan-dish-utils";

// ---------------------------------------------------------------------------
// safeParsePlanJson — dish-centric JSON
// ---------------------------------------------------------------------------

describe("safeParsePlanJson() — dish-centric support", () => {
  it("parses a dish-centric meal plan JSON", () => {
    const json = JSON.stringify({
      title: "My Dish Plan",
      startDate: "2026-03-03",
      endDate: "2026-03-05",
      plan: [
        {
          date: "2026-03-03",
          meals: [
            {
              name: "Breakfast",
              dishes: [
                {
                  dishName: "Overnight Oats",
                  description: "Creamy oats with almond milk",
                  estimatedCalories: 400,
                  items: [
                    { id: 1, name: "Oats", servingsUsed: 2 },
                    { id: 2, name: "Almond Milk", servingsUsed: 1 },
                  ],
                },
              ],
              items: [
                { id: 1, name: "Oats", servingsUsed: 2 },
                { id: 2, name: "Almond Milk", servingsUsed: 1 },
              ],
            },
          ],
        },
      ],
    });

    const { doc, error } = safeParsePlanJson(json);
    expect(error).toBeUndefined();
    expect(doc).not.toBeNull();
    expect(doc!.plan[0].meals[0].dishes).toHaveLength(1);
    expect(doc!.plan[0].meals[0].dishes![0].dishName).toBe("Overnight Oats");
    expect(doc!.plan[0].meals[0].dishes![0].estimatedCalories).toBe(400);
    expect(doc!.plan[0].meals[0].dishes![0].items[0].servingsUsed).toBe(2);
  });

  it("remains backward compatible with flat items (no dishes key)", () => {
    const legacyJson = JSON.stringify({
      title: "Old Plan",
      startDate: "2025-01-01",
      endDate: "2025-01-03",
      plan: [
        {
          date: "2025-01-01",
          meals: [
            {
              name: "Lunch",
              items: [
                { id: 10, name: "Brown Rice" },
                { id: 11, name: "Black Beans" },
              ],
            },
          ],
        },
      ],
    });

    const { doc, error } = safeParsePlanJson(legacyJson);
    expect(error).toBeUndefined();
    expect(doc).not.toBeNull();

    const meal = doc!.plan[0].meals[0];
    // Old plans have no dishes key or undefined
    expect(meal.dishes).toBeUndefined();
    expect(meal.items).toHaveLength(2);
    expect(meal.items[0].id).toBe(10);
    // servingsUsed is optional — may be undefined on old items
    expect(meal.items[0].servingsUsed).toBeUndefined();
  });

  it("returns error for null input", () => {
    const { doc, error } = safeParsePlanJson(null);
    expect(doc).toBeNull();
    expect(error).toBeUndefined(); // no error, just no data
  });

  it("returns error for invalid JSON", () => {
    const { doc, error } = safeParsePlanJson("{not valid json");
    expect(doc).toBeNull();
    expect(error).toBeDefined();
  });

  it("returns error for JSON with wrong shape (no plan array)", () => {
    const { doc, error } = safeParsePlanJson(JSON.stringify({ foo: "bar" }));
    expect(doc).toBeNull();
    expect(error).toBeDefined();
  });

  it("handles dish items where servingsUsed is not present", () => {
    const json = JSON.stringify({
      title: "Plan",
      startDate: "2026-03-03",
      endDate: "2026-03-03",
      plan: [
        {
          date: "2026-03-03",
          meals: [
            {
              name: "Dinner",
              dishes: [
                {
                  dishName: "Simple Stir Fry",
                  items: [{ id: 5, name: "Tofu" }], // no servingsUsed
                },
              ],
              items: [{ id: 5, name: "Tofu" }],
            },
          ],
        },
      ],
    });

    const { doc, error } = safeParsePlanJson(json);
    expect(error).toBeUndefined();
    expect(doc).not.toBeNull();
    // servingsUsed may be undefined — that is acceptable
    const dishItem = doc!.plan[0].meals[0].dishes![0].items[0];
    expect(dishItem.id).toBe(5);
    expect(dishItem.name).toBe("Tofu");
  });
});

// ---------------------------------------------------------------------------
// hasDishes — helper to check if a meal uses dish-centric format
// ---------------------------------------------------------------------------

describe("hasDishes()", () => {
  it("returns true when meal has a non-empty dishes array", () => {
    const meal = {
      name: "Breakfast",
      dishes: [
        {
          dishName: "Oatmeal",
          items: [{ id: 1, name: "Oats", servingsUsed: 1 }],
        },
      ],
      items: [{ id: 1, name: "Oats" }],
    };
    expect(hasDishes(meal)).toBe(true);
  });

  it("returns false when meal has no dishes key", () => {
    const meal = {
      name: "Lunch",
      items: [{ id: 5, name: "Sandwich" }],
    };
    expect(hasDishes(meal)).toBe(false);
  });

  it("returns false when meal has an empty dishes array", () => {
    const meal = {
      name: "Dinner",
      dishes: [],
      items: [{ id: 3, name: "Steak" }],
    };
    expect(hasDishes(meal)).toBe(false);
  });

  it("returns false when dishes is null", () => {
    const meal = {
      name: "Dinner",
      dishes: null as unknown as undefined,
      items: [],
    };
    expect(hasDishes(meal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDishItemLabel — renders chip label with optional "2x" prefix
// ---------------------------------------------------------------------------

describe("getDishItemLabel()", () => {
  it("returns just the name when servingsUsed is 1", () => {
    expect(getDishItemLabel({ id: 1, name: "Oats", servingsUsed: 1 })).toBe(
      "Oats"
    );
  });

  it("returns just the name when servingsUsed is undefined", () => {
    expect(getDishItemLabel({ id: 1, name: "Oats" })).toBe("Oats");
  });

  it("returns '2x Name' when servingsUsed is 2", () => {
    expect(
      getDishItemLabel({ id: 2, name: "Almond Milk", servingsUsed: 2 })
    ).toBe("2x Almond Milk");
  });

  it("returns '5x Name' when servingsUsed is 5", () => {
    expect(
      getDishItemLabel({ id: 3, name: "Brown Rice", servingsUsed: 5 })
    ).toBe("5x Brown Rice");
  });

  it("handles servingsUsed=0 gracefully (treats as no prefix)", () => {
    // servingsUsed=0 should not be in real data (Pydantic rejects it),
    // but frontend is defensive
    expect(getDishItemLabel({ id: 1, name: "Item", servingsUsed: 0 })).toBe(
      "Item"
    );
  });
});
