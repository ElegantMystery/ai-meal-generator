import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "@/components/ui/Select";

describe("Select", () => {
  it("renders a select element", () => {
    render(
      <Select>
        <option value="a">Option A</option>
      </Select>,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders label when provided with id", () => {
    render(
      <Select id="store" label="Store">
        <option value="TJ">Trader Joe's</option>
      </Select>,
    );
    expect(screen.getByLabelText("Store")).toBeInTheDocument();
  });

  it("does not render label when label prop is omitted", () => {
    render(
      <Select id="store">
        <option value="TJ">TJ</option>
      </Select>,
    );
    expect(screen.queryByRole("label")).not.toBeInTheDocument();
  });

  it("renders children as options", () => {
    render(
      <Select>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta" })).toBeInTheDocument();
  });

  it("shows error message when error prop is provided", () => {
    render(
      <Select error="Required">
        <option value="">Pick one</option>
      </Select>,
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("applies error styling when error prop is provided", () => {
    render(
      <Select error="Required">
        <option value="">Pick one</option>
      </Select>,
    );
    expect(screen.getByRole("combobox").className).toContain("border-red-400");
  });

  it("calls onChange when a different option is selected", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <Select value="a" onChange={onChange}>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    await user.selectOptions(screen.getByRole("combobox"), "b");
    expect(onChange).toHaveBeenCalled();
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <Select disabled>
        <option value="a">Alpha</option>
      </Select>,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
