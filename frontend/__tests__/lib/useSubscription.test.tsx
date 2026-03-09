/**
 * TDD tests for useSubscription hook.
 * Written BEFORE the hook implementation (RED phase).
 */

import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the API module
const mockGetSubscriptionStatus = jest.fn();

jest.mock("@/lib/api", () => ({
  getSubscriptionStatus: (...args: unknown[]) => mockGetSubscriptionStatus(...args),
}));

import { useSubscription } from "@/hooks/useSubscription";

const freeStatus = {
  tier: "FREE" as const,
  remainingQuota: 3,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
};

const proStatus = {
  tier: "PRO" as const,
  remainingQuota: -1,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: "2026-04-08T00:00:00Z",
};

describe("useSubscription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts with loading=true and status=null", () => {
    // Never resolves during this test
    mockGetSubscriptionStatus.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSubscription());

    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBeNull();
  });

  it("sets status and loading=false after successful fetch", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(freeStatus);

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toEqual(freeStatus);
  });

  it("handles PRO tier status", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(proStatus);

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status?.tier).toBe("PRO");
    expect(result.current.status?.currentPeriodEnd).toBe("2026-04-08T00:00:00Z");
  });

  it("returns null status on API error (does not throw)", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetSubscriptionStatus.mockRejectedValueOnce(new Error("API down"));

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toBeNull();
    consoleSpy.mockRestore();
  });

  it("refetch re-calls API and updates status", async () => {
    mockGetSubscriptionStatus
      .mockResolvedValueOnce(freeStatus)
      .mockResolvedValueOnce(proStatus);

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status?.tier).toBe("FREE");

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.status?.tier).toBe("PRO"));
    expect(mockGetSubscriptionStatus).toHaveBeenCalledTimes(2);
  });

  it("fetches on mount exactly once", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(freeStatus);

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetSubscriptionStatus).toHaveBeenCalledTimes(1);
  });

  it("exposes a refetch function", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(freeStatus);

    const { result } = renderHook(() => useSubscription());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.refetch).toBe("function");
  });

  it("sets loading=true during refetch", async () => {
    let resolveSecond: (v: typeof freeStatus) => void;
    const secondPromise = new Promise<typeof freeStatus>((res) => {
      resolveSecond = res;
    });

    mockGetSubscriptionStatus
      .mockResolvedValueOnce(freeStatus)
      .mockReturnValueOnce(secondPromise);

    const { result } = renderHook(() => useSubscription());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.refetch();
    });

    expect(result.current.loading).toBe(true);

    act(() => {
      resolveSecond!(proStatus);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status?.tier).toBe("PRO");
  });
});
