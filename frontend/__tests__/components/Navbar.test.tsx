/**
 * TDD tests for Navbar subscription integration.
 * Written BEFORE navbar modifications (RED phase).
 *
 * Covers:
 * 1. FREE users see a "Pricing" nav link
 * 2. PRO users see a "Billing" nav link (calls createPortalSession)
 * 3. PRO users see a "PRO" badge
 * 4. Subscription status null → no badge crash
 */

import { render, screen, fireEvent, act } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

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

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const mockCreatePortalSession = jest.fn();
jest.mock("@/lib/api", () => ({
  createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
}));

const mockNavigateTo = jest.fn();
jest.mock("@/lib/navigate", () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));

import Navbar from "@/components/Navbar";

const defaultProps = {
  userName: "Test User",
  onLogout: jest.fn(),
  loggingOut: false,
};

describe("Navbar — FREE tier user", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows 'Pricing' nav link for FREE users", () => {
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier="FREE"
        subscriptionStatus={null}
      />
    );
    expect(screen.getByRole("link", { name: /pricing/i })).toBeInTheDocument();
  });

  it("'Pricing' link points to /pricing", () => {
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier="FREE"
        subscriptionStatus={null}
      />
    );
    expect(screen.getByRole("link", { name: /pricing/i })).toHaveAttribute("href", "/pricing");
  });

  it("does not show a 'Billing' button for FREE users", () => {
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier="FREE"
        subscriptionStatus={null}
      />
    );
    expect(screen.queryByRole("button", { name: /billing/i })).toBeNull();
  });

  it("does not show 'PRO' badge for FREE users", () => {
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier="FREE"
        subscriptionStatus={null}
      />
    );
    // PRO badge should not be present
    expect(screen.queryByText("PRO")).toBeNull();
  });
});

describe("Navbar — PRO tier user", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows a 'PRO' badge for PRO users", () => {
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier="PRO"
        subscriptionStatus={null}
      />
    );
    expect(screen.getByText("PRO")).toBeInTheDocument();
  });

  it("shows a 'Billing' button for PRO users", () => {
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier="PRO"
        subscriptionStatus={null}
      />
    );
    expect(screen.getByRole("button", { name: /billing/i })).toBeInTheDocument();
  });

  it("does not show 'Pricing' nav link for PRO users", () => {
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier="PRO"
        subscriptionStatus={null}
      />
    );
    expect(screen.queryByRole("link", { name: /pricing/i })).toBeNull();
  });

  it("clicking 'Billing' calls createPortalSession", async () => {
    mockCreatePortalSession.mockResolvedValueOnce({ url: "https://billing.stripe.com/p" });
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier="PRO"
        subscriptionStatus={null}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /billing/i }));
    });

    expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
  });

  it("clicking 'Billing' redirects to portal url", async () => {
    mockCreatePortalSession.mockResolvedValueOnce({ url: "https://billing.stripe.com/portal/abc" });
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier="PRO"
        subscriptionStatus={null}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /billing/i }));
    });

    expect(mockNavigateTo).toHaveBeenCalledWith("https://billing.stripe.com/portal/abc");
  });
});

describe("Navbar — no subscription info (null tier)", () => {
  it("renders without crashing when subscriptionTier is undefined", () => {
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier={undefined}
        subscriptionStatus={null}
      />
    );
    expect(screen.getByText(/test user/i)).toBeInTheDocument();
  });

  it("shows Pricing link when tier is undefined (defaults to free behavior)", () => {
    render(
      <Navbar
        {...defaultProps}
        subscriptionTier={undefined}
        subscriptionStatus={null}
      />
    );
    // Should show Pricing for non-PRO users
    expect(screen.getByRole("link", { name: /pricing/i })).toBeInTheDocument();
  });
});
