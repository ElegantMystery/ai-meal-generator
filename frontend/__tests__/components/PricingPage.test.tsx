/**
 * TDD tests for the Pricing page component.
 * Written BEFORE the page implementation (RED phase).
 */

import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock Next.js navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => ({ get: jest.fn() }),
  usePathname: () => "/pricing",
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

const mockGetSubscriptionStatus = jest.fn();
const mockCreateCheckoutSession = jest.fn();
const mockCreatePortalSession = jest.fn();

jest.mock("@/lib/api", () => ({
  getSubscriptionStatus: (...args: unknown[]) =>
    mockGetSubscriptionStatus(...args),
  createCheckoutSession: (...args: unknown[]) =>
    mockCreateCheckoutSession(...args),
  createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
}));

const mockNavigateTo = jest.fn();
jest.mock("@/lib/navigate", () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));

// Mock useSubscription hook
const mockUseSubscription = jest.fn();
jest.mock("@/hooks/useSubscription", () => ({
  useSubscription: () => mockUseSubscription(),
}));

import PricingPage from "@/app/pricing/page";

describe("PricingPage — loading state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSubscription.mockReturnValue({
      status: null,
      loading: true,
      refetch: jest.fn(),
    });
  });

  it("renders skeleton while loading", () => {
    const { container } = render(<PricingPage />);
    // Should show skeleton placeholders, not actual card content
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

describe("PricingPage — FREE user", () => {
  const refetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSubscription.mockReturnValue({
      status: {
        tier: "FREE",
        remainingQuota: 3,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      },
      loading: false,
      refetch,
    });
  });

  it("renders the page title or 'Back to Dashboard' link", () => {
    render(<PricingPage />);
    expect(
      screen.getByRole("link", { name: /back to dashboard/i }),
    ).toBeInTheDocument();
  });

  it("renders FREE card with $0/mo price", () => {
    render(<PricingPage />);
    expect(screen.getByText(/\$0/i)).toBeInTheDocument();
  });

  it("renders PRO card with $4.99/mo price", () => {
    render(<PricingPage />);
    expect(screen.getByText(/\$4\.99/i)).toBeInTheDocument();
  });

  it("renders FREE plan features", () => {
    render(<PricingPage />);
    expect(screen.getByText(/3 meal plans\/month/i)).toBeInTheDocument();
  });

  it("renders PRO plan features", () => {
    render(<PricingPage />);
    expect(screen.getByText(/unlimited meal plans/i)).toBeInTheDocument();
  });

  it("FREE card shows 'Current Plan' disabled button for FREE user", () => {
    render(<PricingPage />);
    const btn = screen.getByRole("button", { name: /current plan/i });
    expect(btn).toBeDisabled();
  });

  it("PRO card shows 'Upgrade to PRO' button for FREE user", () => {
    render(<PricingPage />);
    expect(
      screen.getByRole("button", { name: /upgrade to pro/i }),
    ).toBeInTheDocument();
  });

  it("'Upgrade to PRO' calls createCheckoutSession", async () => {
    mockCreateCheckoutSession.mockResolvedValueOnce({
      url: "https://stripe.com/checkout",
    });
    render(<PricingPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /upgrade to pro/i }));
    });

    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("'Upgrade to PRO' redirects to checkout url", async () => {
    mockCreateCheckoutSession.mockResolvedValueOnce({
      url: "https://stripe.com/checkout/123",
    });
    render(<PricingPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /upgrade to pro/i }));
    });

    expect(mockNavigateTo).toHaveBeenCalledWith(
      "https://stripe.com/checkout/123",
    );
  });
});

describe("PricingPage — PRO user", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSubscription.mockReturnValue({
      status: {
        tier: "PRO",
        remainingQuota: -1,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "2026-04-08T00:00:00Z",
      },
      loading: false,
      refetch: jest.fn(),
    });
  });

  it("PRO card shows 'Manage Billing' button for PRO user", () => {
    render(<PricingPage />);
    expect(
      screen.getByRole("button", { name: /manage billing/i }),
    ).toBeInTheDocument();
  });

  it("'Manage Billing' calls createPortalSession", async () => {
    mockCreatePortalSession.mockResolvedValueOnce({
      url: "https://billing.stripe.com/portal",
    });
    render(<PricingPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /manage billing/i }));
    });

    expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
  });

  it("PRO card shows 'Current Plan' badge for PRO user", () => {
    render(<PricingPage />);
    // Badge text: "Current Plan" appears in the PRO card
    const badges = screen.getAllByText(/current plan/i);
    expect(badges.length).toBeGreaterThan(0);
  });

  it("FREE card does not show upgrade button for PRO user", () => {
    render(<PricingPage />);
    expect(
      screen.queryByRole("button", { name: /upgrade to pro/i }),
    ).toBeNull();
  });
});
