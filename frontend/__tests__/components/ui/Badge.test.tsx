import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/Badge";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Label</Badge>);
    expect(screen.getByText("Label")).toBeInTheDocument();
  });

  it("renders as a span", () => {
    render(<Badge>Label</Badge>);
    expect(screen.getByText("Label").tagName).toBe("SPAN");
  });

  it("applies default variant classes", () => {
    render(<Badge>Label</Badge>);
    expect(screen.getByText("Label").className).toContain("bg-gray-100");
    expect(screen.getByText("Label").className).toContain("text-gray-700");
  });

  it("applies success variant classes", () => {
    render(<Badge variant="success">Label</Badge>);
    expect(screen.getByText("Label").className).toContain("bg-brand-100");
    expect(screen.getByText("Label").className).toContain("text-brand-700");
  });

  it("applies destructive variant classes", () => {
    render(<Badge variant="destructive">Label</Badge>);
    expect(screen.getByText("Label").className).toContain("bg-red-100");
    expect(screen.getByText("Label").className).toContain("text-red-700");
  });

  it("applies info variant classes", () => {
    render(<Badge variant="info">Label</Badge>);
    expect(screen.getByText("Label").className).toContain("bg-blue-100");
    expect(screen.getByText("Label").className).toContain("text-blue-700");
  });

  it("merges custom className", () => {
    render(<Badge className="ml-2">Label</Badge>);
    expect(screen.getByText("Label").className).toContain("ml-2");
  });
});
