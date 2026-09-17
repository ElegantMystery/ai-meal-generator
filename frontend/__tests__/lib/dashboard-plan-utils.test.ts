import {
  featuredPlan,
  previewDays,
  initialDayIndex,
  localDateKey,
  type SavedPlan,
} from "@/lib/dashboard-plan-utils";

const plan = (
  id: number,
  startDate: string | null,
  endDate: string | null,
  createdAt: string | null,
): SavedPlan => ({
  id,
  title: `Plan ${id}`,
  startDate,
  endDate,
  createdAt,
  planJson: null,
});

describe("dashboard plan selection", () => {
  const today = "2026-09-17";
  it("features the newest plan covering today even when a future plan was created later", () => {
    const older = plan(1, "2026-09-16", "2026-09-18", "2026-09-15T12:00:00Z");
    const current = plan(2, today, today, "2026-09-16T12:00:00Z");
    const future = plan(3, "2026-10-01", "2026-10-03", "2026-09-17T12:00:00Z");
    expect(featuredPlan([future, older, current], today)).toBe(current);
  });
  it("falls back to latest saved without inventing today coverage or hiding unreadable plans", () => {
    const old = plan(1, "2025-01-01", "2025-01-03", "2025-01-01T12:00:00Z");
    const latest = plan(2, null, null, "2026-09-17T12:00:00Z");
    latest.planJson = "{broken";
    expect(featuredPlan([old, latest], today)).toBe(latest);
    expect(featuredPlan([], today)).toBeNull();
  });
  it("does not mutate input or let invalid timestamps outrank known creation dates", () => {
    const plans = [
      plan(1, null, null, null),
      plan(2, null, null, "2026-09-17T12:00:00Z"),
    ];
    expect(featuredPlan(plans, today)?.id).toBe(2);
    expect(plans.map((p) => p.id)).toEqual([1, 2]);
  });
  it("uses local calendar dates rather than UTC dates", () => {
    expect(localDateKey(new Date(2026, 8, 17, 23, 59))).toBe(today);
  });
});

describe("dashboard previews", () => {
  it("uses actual days, selects today when present, otherwise the first available day", () => {
    const days = previewDays(
      JSON.stringify({
        plan: [
          { date: "2026-09-16", meals: [] },
          { date: "2026-09-17", meals: [] },
          { date: "2026-09-19", meals: [] },
        ],
      }),
    );
    expect(days).toHaveLength(3);
    expect(initialDayIndex(days, "2026-09-17")).toBe(1);
    expect(initialDayIndex(days, "2026-10-01")).toBe(0);
    expect(initialDayIndex([], "2026-09-17")).toBe(0);
  });
  it.each([
    null,
    "{bad",
    "{}",
    '{"plan":null}',
    '{"plan":[null,3,{}, {"date":"2026-02-30"}]}',
  ])("safely handles malformed or absent JSON: %s", (value) => {
    expect(previewDays(value)).toEqual([]);
  });
  it("retains dated empty days and renders valid legacy flat item names defensively", () => {
    const days = previewDays(
      JSON.stringify({
        plan: [
          {
            date: "2026-09-17",
            meals: [
              null,
              { name: "Lunch", items: [null, { name: "Bread" }, { name: 12 }] },
            ],
          },
          { date: "2026-09-18", meals: null },
        ],
      }),
    );
    expect(days).toEqual([
      {
        date: "2026-09-17",
        meals: [{ name: "Lunch", dishes: [], itemNames: ["Bread"] }],
      },
      { date: "2026-09-18", meals: [] },
    ]);
  });
  it("keeps real dish copy without inferring per-person calorie scope", () => {
    const days = previewDays(
      JSON.stringify({
        plan: [
          {
            date: "2026-09-17",
            meals: [
              {
                name: "Dinner",
                dishes: [
                  null,
                  {
                    dishName: "Pasta",
                    description: "With tomatoes",
                    estimatedCalories: 900,
                  },
                ],
                items: [],
              },
            ],
          },
        ],
      }),
    );
    expect(days[0].meals[0].dishes).toEqual([
      { name: "Pasta", description: "With tomatoes" },
    ]);
  });
});
