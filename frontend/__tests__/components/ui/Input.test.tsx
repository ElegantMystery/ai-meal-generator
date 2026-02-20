import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/Input";

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders label when provided with id", () => {
    render(<Input id="email" label="Email address" />);
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  });

  it("does not render label when label prop is omitted", () => {
    render(<Input id="email" />);
    expect(screen.queryByRole("label")).not.toBeInTheDocument();
  });

  it("shows error message when error prop is provided", () => {
    render(<Input error="This field is required" />);
    expect(screen.getByText("This field is required")).toBeInTheDocument();
  });

  it("applies error styling to input when error prop is provided", () => {
    render(<Input error="This field is required" />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("border-red-400");
  });

  it("does not show error styling without error prop", () => {
    render(<Input />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("border-gray-300");
    expect(input.className).not.toContain("border-red-400");
  });

  it("forwards value and onChange", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Input value="" onChange={onChange} />);
    await user.type(screen.getByRole("textbox"), "hello");
    expect(onChange).toHaveBeenCalled();
  });

  it("respects placeholder prop", () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
  });

  it("forwards type attribute", () => {
    render(<Input type="password" id="pw" label="Password" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
  });

  it("is disabled when disabled prop is true", () => {
    render(<Input disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("accepts additional className", () => {
    render(<Input className="custom-class" />);
    expect(screen.getByRole("textbox").className).toContain("custom-class");
  });
});
