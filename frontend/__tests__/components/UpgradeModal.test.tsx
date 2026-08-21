/**
 * TDD tests for UpgradeModal component.
 * Written BEFORE the component implementation (RED phase).
 */

import { render, screen, fireEvent, act } from "@testing-library/react";

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

const mockCreateCheckoutSession = jest.fn();
jest.mock("@/lib/api", () => ({
  createCheckoutSession: (...args: unknown[]) => mockCreateCheckoutSession(...args),
}));

const mockNavigateTo = jest.fn();
jest.mock("@/lib/navigate", () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));

import UpgradeModal from "@/components/UpgradeModal";
import { ToastProvider } from "@/components/ui/Toast";

function renderModal(open: boolean, onClose = jest.fn()) {
  return render(
    <ToastProvider>
      <UpgradeModal open={open} onClose={onClose} />
    </ToastProvider>,
  );
}

describe("UpgradeModal — closed state", () => {
  it("renders nothing when open=false", () => {
    const { container } = renderModal(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("UpgradeModal — open state", () => {
  const onClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    renderModal(true, onClose);
  });

  it("renders the heading", () => {
    expect(
      screen.getByText(/you've reached your free plan limit/i)
    ).toBeInTheDocument();
  });

  it("renders the body copy", () => {
    expect(
      screen.getByText(/upgrade to pro for unlimited meal plan generation/i)
    ).toBeInTheDocument();
  });

  it("renders 'Upgrade to PRO' primary button", () => {
    expect(
      screen.getByRole("button", { name: /upgrade to pro/i })
    ).toBeInTheDocument();
  });

  it("renders 'Maybe Later' button", () => {
    expect(
      screen.getByRole("button", { name: /maybe later/i })
    ).toBeInTheDocument();
  });

  it("renders 'Compare plans →' link pointing to /pricing", () => {
    const link = screen.getByRole("link", { name: /compare plans/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/pricing");
  });

  it("calls onClose when 'Maybe Later' is clicked", () => {
    fireEvent.click(screen.getByRole("button", { name: /maybe later/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls createCheckoutSession when 'Upgrade to PRO' is clicked", async () => {
    mockCreateCheckoutSession.mockResolvedValueOnce({ url: "https://stripe.com/checkout/abc" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /upgrade to pro/i }));
    });

    expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("redirects to checkout url after clicking 'Upgrade to PRO'", async () => {
    mockCreateCheckoutSession.mockResolvedValueOnce({ url: "https://stripe.com/checkout/xyz" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /upgrade to pro/i }));
    });

    expect(mockNavigateTo).toHaveBeenCalledWith("https://stripe.com/checkout/xyz");
  });

  it("shows loading state on 'Upgrade to PRO' button while fetching", async () => {
    let resolve: (v: { url: string }) => void;
    const pending = new Promise<{ url: string }>((res) => { resolve = res; });
    mockCreateCheckoutSession.mockReturnValueOnce(pending);

    const btn = screen.getByRole("button", { name: /upgrade to pro/i });
    fireEvent.click(btn);

    // Button should now be disabled / show loading
    expect(btn).toBeDisabled();

    act(() => { resolve!({ url: "https://stripe.com" }); });
  });
});
