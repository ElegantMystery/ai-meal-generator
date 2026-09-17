import { render, screen } from "@testing-library/react";
import { DashboardPreferences } from "@/components/dashboard/DashboardPreferences";

describe("dashboard preferences", () => {
  it("distinguishes loading and failure from unset preferences", () => {
    const { rerender } = render(
      <DashboardPreferences prefs={null} state="loading" />,
    );
    expect(screen.getByText("Loading preferences…")).toBeInTheDocument();
    expect(screen.queryByText(/not set/i)).not.toBeInTheDocument();
    rerender(<DashboardPreferences prefs={null} state="error" />);
    expect(
      screen.getByText(
        "Preferences unavailable. Check your settings before generating.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no allergies/i)).not.toBeInTheDocument();
    rerender(<DashboardPreferences prefs={null} state="ready" />);
    expect(screen.getByText("Diet not set")).toBeInTheDocument();
    expect(screen.getByText("Allergies not set")).toBeInTheDocument();
    expect(screen.getByText("Calorie target not set")).toBeInTheDocument();
  });
  it("shows saved preferences and a clearly scoped target beside the settings link", () => {
    render(
      <DashboardPreferences
        state="ready"
        prefs={{
          dietaryRestrictions: "high-protein",
          allergies: "peanuts; milk",
          targetCaloriesPerDay: 2000,
        }}
      />,
    );
    expect(screen.getByText("High protein")).toBeInTheDocument();
    expect(screen.getByText("Allergies: peanuts, milk")).toBeInTheDocument();
    expect(
      screen.getByText("Target: 2,000 kcal / person / day"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Edit preferences" }),
    ).toHaveAttribute("href", "/settings");
  });
});
