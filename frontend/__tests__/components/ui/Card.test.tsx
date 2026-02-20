import { render, screen } from "@testing-library/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";

describe("Card compound components", () => {
  it("Card renders children in a div with default styles", () => {
    render(<Card data-testid="card">Content</Card>);
    const el = screen.getByTestId("card");
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("bg-white");
    expect(el.className).toContain("rounded-xl");
  });

  it("Card merges custom className", () => {
    render(<Card data-testid="card" className="border-red-500">Content</Card>);
    expect(screen.getByTestId("card").className).toContain("border-red-500");
  });

  it("CardHeader renders children", () => {
    render(<CardHeader data-testid="ch">Header</CardHeader>);
    expect(screen.getByTestId("ch")).toBeInTheDocument();
  });

  it("CardTitle renders as an h3", () => {
    render(<CardTitle>My Title</CardTitle>);
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent("My Title");
    expect(heading.className).toContain("font-semibold");
  });

  it("CardDescription renders as a paragraph", () => {
    render(<CardDescription>Some description</CardDescription>);
    expect(screen.getByText("Some description").tagName).toBe("P");
  });

  it("CardContent renders children in a div", () => {
    render(<CardContent data-testid="cc">Body content</CardContent>);
    const el = screen.getByTestId("cc");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveTextContent("Body content");
    expect(el.className).toContain("px-6");
  });

  it("renders a full card composition", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>Your settings.</CardDescription>
        </CardHeader>
        <CardContent>Content here</CardContent>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByText("Your settings.")).toBeInTheDocument();
    expect(screen.getByText("Content here")).toBeInTheDocument();
  });
});
