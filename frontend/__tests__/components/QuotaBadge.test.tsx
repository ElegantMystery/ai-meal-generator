/** TDD tests for the FREE quota indicator and hidden PRO state. */

import { render, screen } from "@testing-library/react";

// Mock next/link
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import QuotaBadge from "@/components/QuotaBadge";

describe("QuotaBadge — FREE tier", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders '3 plans remaining' with default variant when 3 remain", () => {
    render(<QuotaBadge tier="FREE" remainingQuota={3} />);
    expect(screen.getByText(/3 plans remaining/i)).toBeInTheDocument();
    const badge = screen.getByText(/3 plans remaining/i);
    // default variant uses gray-100 / gray-700
    expect(badge.className).toMatch(/bg-gray-100|text-gray-700/);
  });

  it("renders '1 plan remaining · Upgrade' with warning variant when 1 remains", () => {
    render(<QuotaBadge tier="FREE" remainingQuota={1} />);
    expect(screen.getByText(/1 plan remaining/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upgrade/i })).toBeInTheDocument();
  });

  it("'Upgrade' link points to /pricing", () => {
    render(<QuotaBadge tier="FREE" remainingQuota={1} />);
    const link = screen.getByRole("link", { name: /upgrade/i });
    expect(link).toHaveAttribute("href", "/pricing");
  });

  it("renders 'No plans remaining · Upgrade' with destructive variant when 0 remain", () => {
    render(<QuotaBadge tier="FREE" remainingQuota={0} />);
    expect(screen.getByText(/no plans remaining/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upgrade/i })).toBeInTheDocument();
  });

  it("renders warning badge class when 1 remaining", () => {
    const { container } = render(<QuotaBadge tier="FREE" remainingQuota={1} />);
    // The outer Badge span wraps all children — find the outermost span
    const outerBadge = container.querySelector("span");
    expect(outerBadge?.className).toMatch(/bg-accent-100|text-accent-600/);
  });

  it("renders destructive badge class when 0 remaining", () => {
    const { container } = render(<QuotaBadge tier="FREE" remainingQuota={0} />);
    const outerBadge = container.querySelector("span");
    expect(outerBadge?.className).toMatch(/bg-red-100|text-red-700/);
  });

  it("renders '2 plans remaining' for 2 remaining", () => {
    render(<QuotaBadge tier="FREE" remainingQuota={2} />);
    expect(screen.getByText(/2 plans remaining/i)).toBeInTheDocument();
  });

  it("renders upgrade link also when 0 remaining", () => {
    render(<QuotaBadge tier="FREE" remainingQuota={0} />);
    const link = screen.getByRole("link", { name: /upgrade/i });
    expect(link).toHaveAttribute("href", "/pricing");
  });
});

describe("QuotaBadge — PRO tier", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders nothing", () => {
    const { container } = render(<QuotaBadge tier="PRO" remainingQuota={-1} />);
    expect(container).toBeEmptyDOMElement();
  });
});
