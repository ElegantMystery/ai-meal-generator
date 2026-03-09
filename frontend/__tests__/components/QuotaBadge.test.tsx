/**
 * TDD tests for QuotaBadge component.
 * Written BEFORE the component implementation (RED phase).
 *
 * Note on window.location: jsdom makes window.location properties non-writable.
 * We test redirect behavior by mocking the navigate utility from @/lib/navigate
 * which wraps window.location.assign and is injected/imported by the component.
 */

import { render, screen, fireEvent, act } from "@testing-library/react";

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

// Mock API for portal session redirect
const mockCreatePortalSession = jest.fn();
jest.mock("@/lib/api", () => ({
  createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
}));

// Mock the navigate helper so we don't touch window.location in tests
const mockNavigateTo = jest.fn();
jest.mock("@/lib/navigate", () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));

// Mock Toast so component can call useToast without a Provider
const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
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

  it("renders 'PRO · Unlimited' with success variant", () => {
    render(<QuotaBadge tier="PRO" remainingQuota={-1} />);
    expect(screen.getByText(/PRO/i)).toBeInTheDocument();
    expect(screen.getByText(/unlimited/i)).toBeInTheDocument();
  });

  it("applies success variant classes for PRO", () => {
    const { container } = render(<QuotaBadge tier="PRO" remainingQuota={-1} />);
    const outerBadge = container.querySelector("span");
    expect(outerBadge?.className).toMatch(/bg-brand-100|text-brand-700/);
  });

  it("shows a Manage button for PRO that calls createPortalSession", async () => {
    mockCreatePortalSession.mockResolvedValueOnce({
      url: "https://billing.stripe.com/p",
    });
    render(<QuotaBadge tier="PRO" remainingQuota={-1} />);
    const manageBtn = screen.getByRole("button", { name: /manage/i });
    expect(manageBtn).toBeInTheDocument();
    fireEvent.click(manageBtn);
    expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
  });

  it("redirects to portal url via navigateTo after clicking Manage", async () => {
    mockCreatePortalSession.mockResolvedValueOnce({
      url: "https://billing.stripe.com/portal/abc",
    });
    render(<QuotaBadge tier="PRO" remainingQuota={-1} />);
    const manageBtn = screen.getByRole("button", { name: /manage/i });

    await act(async () => {
      fireEvent.click(manageBtn);
    });

    expect(mockNavigateTo).toHaveBeenCalledWith(
      "https://billing.stripe.com/portal/abc",
    );
  });

  it("does not crash if createPortalSession fails", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockCreatePortalSession.mockRejectedValueOnce(
      new Error("portal unavailable"),
    );
    render(<QuotaBadge tier="PRO" remainingQuota={-1} />);
    const manageBtn = screen.getByRole("button", { name: /manage/i });

    await act(async () => {
      fireEvent.click(manageBtn);
    });

    expect(mockNavigateTo).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
