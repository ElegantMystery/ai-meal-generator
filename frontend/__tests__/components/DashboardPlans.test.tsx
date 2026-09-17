import { fireEvent, render, screen } from "@testing-library/react";
import {
  FeaturedPlan,
  PlanHistory,
} from "@/components/dashboard/DashboardPlans";
import type { SavedPlan } from "@/lib/dashboard-plan-utils";
const plan: SavedPlan = {
  id: 1,
  title: "A little green",
  startDate: "2026-09-16",
  endDate: "2026-09-18",
  createdAt: null,
  planJson: JSON.stringify({
    plan: [
      {
        date: "2026-09-16",
        meals: [{ name: "Lunch", items: [{ name: "Bread" }] }],
      },
      {
        date: "2026-09-17",
        meals: [
          {
            name: "Dinner",
            dishes: [
              {
                dishName: "Tomato pasta",
                description: "Roasted tomatoes and basil",
                estimatedCalories: 900,
              },
            ],
          },
        ],
      },
    ],
  }),
};
describe("featured dashboard plan", () => {
  it("selects today and navigates only actual days with accessible selected state", () => {
    render(
      <FeaturedPlan
        plan={plan}
        today="2026-09-17"
        basket={{ state: "ready", total: 42.5 }}
      />,
    );
    expect(screen.getByText("Tomato pasta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sep 17/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: /Sep 16/ }));
    expect(screen.getByText("Bread")).toBeInTheDocument();
    expect(screen.queryByText("Tomato pasta")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("$42.50")).toBeInTheDocument();
    expect(screen.getByText("Estimated basket")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Shopping list/ })).toHaveAttribute(
      "href",
      "/mealplans/1",
    );
    expect(screen.queryByText(/900/)).not.toBeInTheDocument();
  });
  it("does not label an expired plan today and keeps unreadable plans accessible", () => {
    const { rerender } = render(
      <FeaturedPlan
        plan={plan}
        today="2026-10-01"
        basket={{ state: "error" }}
      />,
    );
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.getByText("Bread")).toBeInTheDocument();
    expect(screen.getByText("Basket estimate unavailable")).toBeInTheDocument();
    rerender(
      <FeaturedPlan
        key={2}
        plan={{ ...plan, id: 2, planJson: "{bad" }}
        today="2026-10-01"
        basket={{ state: "loading" }}
      />,
    );
    expect(
      screen.getByText(
        "Day preview unavailable. Your saved plan is still accessible.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View plan/ })).toHaveAttribute(
      "href",
      "/mealplans/2",
    );
    expect(screen.getByText("Loading basket estimate…")).toBeInTheDocument();
  });
});
describe("plan history", () => {
  it("shows a compact history and makes every saved plan accessible, including malformed plans", () => {
    render(
      <PlanHistory
        plans={Array.from({ length: 6 }, (_, i) => ({
          ...plan,
          id: i + 1,
          title: `Saved plan ${i + 1}`,
          planJson: null,
        }))}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Show all 6 plans" }));
    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(screen.getByRole("link", { name: /Saved plan 6/ })).toHaveAttribute(
      "href",
      "/mealplans/6",
    );
  });
});
