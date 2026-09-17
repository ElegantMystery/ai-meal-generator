import { fireEvent, render, screen } from "@testing-library/react";
import { PlanComposer } from "@/components/dashboard/PlanComposer";
const defaults = {
  store: "TRADER_JOES" as const,
  days: 7,
  servings: 1,
  busy: false,
  onStoreChange: jest.fn(),
  onDaysChange: jest.fn(),
  onServingsChange: jest.fn(),
  onGenerate: jest.fn(),
  preferences: <p>Saved preferences</p>,
};
it("keeps labeled supported choices and only one generation action", () => {
  render(<PlanComposer {...defaults} />);
  expect(screen.getByLabelText("Store")).toHaveValue("TRADER_JOES");
  expect(screen.getByLabelText("Duration")).toHaveValue("7");
  expect(screen.getByLabelText("Servings")).toHaveValue("1");
  expect(screen.getByLabelText("Servings").children).toHaveLength(12);
  fireEvent.change(screen.getByLabelText("Store"), {
    target: { value: "WHOLE_FOODS" },
  });
  expect(defaults.onStoreChange).toHaveBeenCalledWith("WHOLE_FOODS");
  fireEvent.change(screen.getByLabelText("Duration"), {
    target: { value: "3" },
  });
  expect(defaults.onDaysChange).toHaveBeenCalledWith(3);
  fireEvent.change(screen.getByLabelText("Servings"), {
    target: { value: "12" },
  });
  expect(defaults.onServingsChange).toHaveBeenCalledWith(12);
  fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
  expect(defaults.onGenerate).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("button")).toHaveLength(1);
});
it("preserves controlled values while generation disables edits and repeat submission", () => {
  render(
    <PlanComposer
      {...defaults}
      store="WHOLE_FOODS"
      days={3}
      servings={4}
      busy
    />,
  );
  expect(screen.getByLabelText("Store")).toBeDisabled();
  expect(screen.getByLabelText("Duration")).toHaveValue("3");
  expect(screen.getByLabelText("Servings")).toHaveValue("4");
  expect(screen.getByRole("button")).toBeDisabled();
});
