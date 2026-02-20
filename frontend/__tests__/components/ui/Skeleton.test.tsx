import { render, screen } from "@testing-library/react";
import { Skeleton, SkeletonText, SkeletonCard } from "@/components/ui/Skeleton";

describe("Skeleton", () => {
  it("renders a div with pulse animation class", () => {
    render(<Skeleton data-testid="sk" />);
    const el = screen.getByTestId("sk");
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("bg-gray-200");
  });

  it("merges custom className", () => {
    render(<Skeleton data-testid="sk" className="h-8 w-32" />);
    const el = screen.getByTestId("sk");
    expect(el.className).toContain("h-8");
    expect(el.className).toContain("w-32");
  });
});

describe("SkeletonText", () => {
  it("renders 3 skeleton lines by default", () => {
    render(<SkeletonText />);
    // Each line is an animate-pulse div
    const lines = document.querySelectorAll(".animate-pulse");
    expect(lines).toHaveLength(3);
  });

  it("renders the correct number of lines from the lines prop", () => {
    render(<SkeletonText lines={5} />);
    const lines = document.querySelectorAll(".animate-pulse");
    expect(lines).toHaveLength(5);
  });

  it("renders 1 line when lines=1", () => {
    render(<SkeletonText lines={1} />);
    const lines = document.querySelectorAll(".animate-pulse");
    expect(lines).toHaveLength(1);
  });

  it("last line is shorter than full width when lines > 1", () => {
    render(<SkeletonText lines={3} />);
    const lines = Array.from(document.querySelectorAll(".animate-pulse"));
    // Last line gets w-3/4 class
    expect(lines[2].className).toContain("w-3/4");
    expect(lines[0].className).toContain("w-full");
  });
});

describe("SkeletonCard", () => {
  it("renders without crashing", () => {
    render(<SkeletonCard />);
    // SkeletonCard contains skeleton lines via SkeletonText
    const lines = document.querySelectorAll(".animate-pulse");
    expect(lines.length).toBeGreaterThan(0);
  });

  it("merges custom className on the wrapper", () => {
    render(<SkeletonCard className="shadow-none" />);
    // The outer wrapper should have the class
    const wrapper = document.querySelector(".shadow-none");
    expect(wrapper).not.toBeNull();
  });
});
