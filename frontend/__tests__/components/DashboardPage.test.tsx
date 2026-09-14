/**
 * TDD tests for Dashboard page subscription integration.
 * Written BEFORE dashboard modifications (RED phase).
 *
 * Focuses on:
 * 1. QuotaBadge is rendered with tier/remainingQuota from useSubscription
 * 2. 429 QUOTA_EXCEEDED → showUpgradeModal
 * 3. UpgradeModal is rendered in the page
 * 4. ?upgrade=success query param → success toast + refetch
 * 5. refetch() is called after successful plan generation
 */

import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

// ---- Next.js mocks ----
const mockRouterReplace = jest.fn();
const mockSearchParamsGet = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
  useSearchParams: () => ({ get: mockSearchParamsGet }),
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

// ---- Auth store mock ----
jest.mock("@/lib/authStore", () => ({
  useAuthStore: (selector: (s: { user: { name: string }; preferencesVersion: number }) => unknown) =>
    selector({ user: { name: "Test User" }, preferencesVersion: 0 }),
}));

// ---- API mock — use jest.fn() directly inside factory ----
jest.mock("@/lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  getSubscriptionStatus: jest.fn(),
  createCheckoutSession: jest.fn(),
  createPortalSession: jest.fn(),
}));

// ---- Navigate mock ----
jest.mock("@/lib/navigate", () => ({
  navigateTo: jest.fn(),
}));

// ---- useSubscription mock ----
jest.mock("@/hooks/useSubscription", () => ({
  useSubscription: jest.fn(),
}));

jest.mock("@/lib/sse", () => ({
  streamMealPlan: jest.fn(),
}));

// ---- Toast mock ----
jest.mock("@/components/ui/Toast", () => ({
  useToast: jest.fn(() => ({ toast: jest.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---- Import mocked modules AFTER jest.mock calls ----
import * as apiModule from "@/lib/api";
import * as subscriptionHook from "@/hooks/useSubscription";
import * as toastModule from "@/components/ui/Toast";
import * as sseModule from "@/lib/sse";
import DashboardPage from "@/app/dashboard/page";

// Type helpers
const mockApi = apiModule.api as { get: jest.Mock; post: jest.Mock };
const mockUseSubscription = subscriptionHook.useSubscription as jest.Mock;
const mockUseToast = toastModule.useToast as jest.Mock;
const mockStreamMealPlan = sseModule.streamMealPlan as jest.Mock;

const freeStatus = {
  tier: "FREE" as const,
  remainingQuota: 2,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
};

const mockRefetch = jest.fn();
const mockToast = jest.fn();

function setupDefaultMocks() {
  localStorage.clear();
  mockSearchParamsGet.mockReturnValue(null);
  mockUseSubscription.mockReturnValue({
    status: freeStatus,
    loading: false,
    refetch: mockRefetch,
  });
  mockUseToast.mockReturnValue({ toast: mockToast });
  mockStreamMealPlan.mockResolvedValue(undefined);
  mockApi.get.mockImplementation((url: string) => {
    if (url === "/api/preferences/me") return Promise.resolve({ data: null });
    if (url === "/api/mealplans") return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unknown url: ${url}`));
  });
}

describe("Dashboard — durable generation recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefaultMocks();
  });

  it("recovers a saved plan after a page refresh using the idempotency key", async () => {
    localStorage.setItem(
      "activeMealPlanGeneration",
      JSON.stringify({ idempotencyKey: "recover-key" }),
    );
    mockApi.get.mockImplementation((url: string) => {
      if (url === "/api/preferences/me") return Promise.resolve({ data: null });
      if (url === "/api/mealplans") return Promise.resolve({ data: [] });
      if (url === "/api/mealplans/generation-requests") {
        return Promise.resolve({
          data: {
            id: "00000000-0000-0000-0000-000000000001",
            status: "SUCCEEDED",
            failureCode: null,
            mealPlanId: 88,
          },
        });
      }
      if (url === "/api/mealplans/88") {
        return Promise.resolve({
          data: {
            id: 88,
            title: "Recovered Plan",
            startDate: null,
            endDate: null,
            planJson: null,
            createdAt: null,
          },
        });
      }
      return Promise.reject(new Error(`unknown url: ${url}`));
    });

    render(<DashboardPage />);

    expect(await screen.findByText("Recovered Plan")).toBeInTheDocument();
    expect(localStorage.getItem("activeMealPlanGeneration")).toBeNull();
  });

  it("keeps the selected servings in recovery state after receiving a request id", async () => {
    mockStreamMealPlan.mockImplementationOnce(async ({ onEvent }) => {
      expect(JSON.parse(localStorage.getItem("activeMealPlanGeneration") ?? "{}"))
        .toEqual(expect.objectContaining({ servings: 4 }));
      onEvent({
        event: "generation_status",
        data: {
          id: "00000000-0000-0000-0000-000000000004",
          status: "RUNNING",
          failureCode: null,
          mealPlanId: null,
        },
      });
      expect(JSON.parse(localStorage.getItem("activeMealPlanGeneration") ?? "{}"))
        .toEqual(expect.objectContaining({
          requestId: "00000000-0000-0000-0000-000000000004",
          servings: 4,
        }));
    });
    render(<DashboardPage />);
    fireEvent.change(await screen.findByLabelText("Servings"), {
      target: { value: "4" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    });

    await waitFor(() => expect(mockStreamMealPlan).toHaveBeenCalled());
  });

  it("hydrates the servings selector from a saved generation after reload", async () => {
    localStorage.setItem(
      "activeMealPlanGeneration",
      JSON.stringify({
        idempotencyKey: "recover-four",
        requestId: "00000000-0000-0000-0000-000000000014",
        servings: 4,
      }),
    );
    mockApi.get.mockImplementation((url: string) => {
      if (url === "/api/preferences/me") return Promise.resolve({ data: null });
      if (url === "/api/mealplans") return Promise.resolve({ data: [] });
      if (url === "/api/mealplans/generation-requests/00000000-0000-0000-0000-000000000014") {
        return Promise.resolve({
          data: {
            id: "00000000-0000-0000-0000-000000000014",
            status: "FAILED",
            failureCode: "GENERATION_FAILED",
            mealPlanId: null,
          },
        });
      }
      return Promise.reject(new Error(`unknown url: ${url}`));
    });

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByLabelText("Servings")).toHaveValue("4"));
  });

  it("defaults legacy recovery state without servings to one", async () => {
    localStorage.setItem(
      "activeMealPlanGeneration",
      JSON.stringify({
        idempotencyKey: "recover-legacy",
        requestId: "00000000-0000-0000-0000-000000000015",
      }),
    );
    mockApi.get.mockImplementation((url: string) => {
      if (url === "/api/preferences/me") return Promise.resolve({ data: null });
      if (url === "/api/mealplans") return Promise.resolve({ data: [] });
      if (url === "/api/mealplans/generation-requests/00000000-0000-0000-0000-000000000015") {
        return Promise.resolve({
          data: {
            id: "00000000-0000-0000-0000-000000000015",
            status: "FAILED",
            failureCode: "GENERATION_FAILED",
            mealPlanId: null,
          },
        });
      }
      return Promise.reject(new Error(`unknown url: ${url}`));
    });

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByLabelText("Servings")).toHaveValue("1"));
  });

  it.each([0, 13, 2.5, "4", null])(
    "defaults invalid recovered servings %p to one",
    async (invalidServings) => {
      localStorage.setItem(
        "activeMealPlanGeneration",
        JSON.stringify({
          idempotencyKey: "recover-invalid",
          requestId: "00000000-0000-0000-0000-000000000016",
          servings: invalidServings,
        }),
      );
      mockApi.get.mockImplementation((url: string) => {
        if (url === "/api/preferences/me") return Promise.resolve({ data: null });
        if (url === "/api/mealplans") return Promise.resolve({ data: [] });
        if (url === "/api/mealplans/generation-requests/00000000-0000-0000-0000-000000000016") {
          return Promise.resolve({
            data: {
              id: "00000000-0000-0000-0000-000000000016",
              status: "FAILED",
              failureCode: "GENERATION_FAILED",
              mealPlanId: null,
            },
          });
        }
        return Promise.reject(new Error(`unknown url: ${url}`));
      });

      render(<DashboardPage />);

      await waitFor(() => expect(screen.getByLabelText("Servings")).toHaveValue("1"));
    },
  );
});

describe("Dashboard — servings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefaultMocks();
  });

  it("offers accessible integer servings from 1 through 12 and defaults to one", async () => {
    render(<DashboardPage />);

    const control = await screen.findByLabelText("Servings") as HTMLSelectElement;
    expect(control).toHaveValue("1");
    expect(Array.from(control.options).map((option) => option.value)).toEqual(
      Array.from({ length: 12 }, (_, index) => String(index + 1)),
    );
  });

  it("sends the selected servings through AI generation", async () => {
    mockStreamMealPlan.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({
        event: "mealplan_saved",
        data: {
          id: 45,
          title: "AI Plan",
          startDate: null,
          endDate: null,
          planJson: null,
          createdAt: null,
        },
      });
    });
    render(<DashboardPage />);
    fireEvent.change(await screen.findByLabelText("Servings"), {
      target: { value: "6" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    });

    expect(mockStreamMealPlan).toHaveBeenCalledWith(
      expect.objectContaining({ servings: 6 }),
    );
  });

  it("sends the selected servings through rule-based generation", async () => {
    mockApi.post.mockResolvedValueOnce({
      data: {
        id: 46,
        title: "Rule Plan",
        startDate: null,
        endDate: null,
        planJson: null,
        createdAt: null,
      },
    });
    render(<DashboardPage />);
    fireEvent.change(await screen.findByLabelText("Servings"), {
      target: { value: "3" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate \(rule-based\)/i }));
    });

    expect(mockApi.post).toHaveBeenCalledWith(
      "/api/mealplans/generate",
      null,
      { params: { store: "TRADER_JOES", days: 7, servings: 3 } },
    );
  });

  it("uses a fresh idempotency key when retrying with changed servings", async () => {
    mockStreamMealPlan.mockRejectedValue(new Error("SSE disconnected"));
    render(<DashboardPage />);
    const servingsControl = await screen.findByLabelText("Servings");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    });
    const firstKey = mockStreamMealPlan.mock.calls[0][0].idempotencyKey;
    await waitFor(() => expect(screen.getByRole("button", { name: /generate with ai/i })).toBeEnabled());
    fireEvent.change(servingsControl, { target: { value: "2" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    });

    const secondKey = mockStreamMealPlan.mock.calls[1][0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
    expect(JSON.parse(localStorage.getItem("activeMealPlanGeneration") ?? "{}"))
      .toEqual(expect.objectContaining({ idempotencyKey: secondKey, servings: 2 }));
  });

  it("reuses the idempotency key when retrying with the same selection", async () => {
    mockStreamMealPlan.mockRejectedValue(new Error("SSE disconnected"));
    render(<DashboardPage />);
    await screen.findByLabelText("Servings");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    });
    const firstKey = mockStreamMealPlan.mock.calls[0][0].idempotencyKey;
    await waitFor(() => expect(screen.getByRole("button", { name: /generate with ai/i })).toBeEnabled());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    });

    expect(mockStreamMealPlan.mock.calls[1][0].idempotencyKey).toBe(firstKey);
  });
});

describe("Dashboard — QuotaBadge integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefaultMocks();
  });

  it("renders QuotaBadge with remaining quota from useSubscription", async () => {
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/2 plans remaining/i)).toBeInTheDocument();
    });
  });

  it("renders QuotaBadge with PRO status", async () => {
    mockUseSubscription.mockReturnValue({
      status: { tier: "PRO", remainingQuota: -1, cancelAtPeriodEnd: false, currentPeriodEnd: null },
      loading: false,
      refetch: mockRefetch,
    });
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/PRO/i)).toBeInTheDocument();
    });
  });

  it("does not crash when subscription status is null", async () => {
    mockUseSubscription.mockReturnValue({ status: null, loading: true, refetch: mockRefetch });
    render(<DashboardPage />);
    await waitFor(() => {
      expect(screen.getByText(/dashboard/i)).toBeInTheDocument();
    });
  });
});

describe("Dashboard — UpgradeModal on 429 QUOTA_EXCEEDED", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefaultMocks();
  });

  it("shows UpgradeModal when AI generate returns 429 QUOTA_EXCEEDED", async () => {
    const quotaError = {
      response: { status: 429, data: { error: "QUOTA_EXCEEDED" } },
    };
    mockStreamMealPlan.mockRejectedValueOnce(quotaError);
    render(<DashboardPage />);
    await waitFor(() => screen.getByRole("button", { name: /generate with ai/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/you've reached your free plan limit/i)
      ).toBeInTheDocument();
    });
  });

  it("shows UpgradeModal when rule-based generate returns 429 QUOTA_EXCEEDED", async () => {
    const quotaError = {
      response: { status: 429, data: { error: "QUOTA_EXCEEDED" } },
    };
    mockApi.post.mockRejectedValueOnce(quotaError);
    render(<DashboardPage />);
    await waitFor(() => screen.getByRole("button", { name: /generate \(rule-based\)/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate \(rule-based\)/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/you've reached your free plan limit/i)
      ).toBeInTheDocument();
    });
  });

  it("shows generic error (not upgrade modal) for non-403 errors", async () => {
    mockStreamMealPlan.mockRejectedValueOnce(new Error("Server Error"));
    render(<DashboardPage />);
    await waitFor(() => screen.getByRole("button", { name: /generate with ai/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    });

    await waitFor(() => {
      expect(
        screen.queryByText(/you've reached your free plan limit/i)
      ).toBeNull();
    });
  });
});

describe("Dashboard — upgrade=success query param", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "upgrade" ? "success" : null
    );
    mockUseSubscription.mockReturnValue({
      status: { tier: "PRO", remainingQuota: -1, cancelAtPeriodEnd: false, currentPeriodEnd: null },
      loading: false,
      refetch: mockRefetch,
    });
    mockUseToast.mockReturnValue({ toast: mockToast });
    mockApi.get.mockImplementation((url: string) => {
      if (url === "/api/preferences/me") return Promise.resolve({ data: null });
      if (url === "/api/mealplans") return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`unknown url: ${url}`));
    });
  });

  it("shows success toast when ?upgrade=success is present", async () => {
    render(<DashboardPage />);
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/welcome to pro/i),
        "success"
      );
    });
  });

  it("calls refetch after upgrade success", async () => {
    render(<DashboardPage />);
    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  it("calls router.replace('/dashboard') to strip upgrade param from URL", async () => {
    render(<DashboardPage />);
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/dashboard");
    });
  });
});

describe("Dashboard — refetch after successful generation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefaultMocks();
  });

  it("calls refetch after AI meal plan is generated", async () => {
    mockStreamMealPlan.mockImplementationOnce(async ({ onEvent }) => {
      onEvent({
        event: "mealplan_saved",
        data: {
        id: 42,
        title: "Test Plan",
        startDate: null,
        endDate: null,
        planJson: null,
        createdAt: null,
        },
      });
    });
    render(<DashboardPage />);
    await waitFor(() => screen.getByRole("button", { name: /generate with ai/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    });

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  it("calls refetch after rule-based meal plan is generated", async () => {
    mockApi.post.mockResolvedValueOnce({
      data: {
        id: 43,
        title: "Rule Plan",
        startDate: null,
        endDate: null,
        planJson: null,
        createdAt: null,
      },
    });
    render(<DashboardPage />);
    await waitFor(() => screen.getByRole("button", { name: /generate \(rule-based\)/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate \(rule-based\)/i }));
    });

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
    });
  });
});
