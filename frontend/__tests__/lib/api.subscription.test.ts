/**
 * Tests for subscription API functions in lib/api.ts
 *
 * Strategy: mock the `api` axios instance's get/post methods using
 * jest.spyOn after importing, so the module's closure picks up the mocks.
 */

import * as apiModule from "@/lib/api";
import { SubscriptionStatus } from "@/lib/api";

describe("getSubscriptionStatus", () => {
  let getSpy: jest.SpyInstance;

  beforeEach(() => {
    getSpy = jest.spyOn(apiModule.api, "get");
  });

  afterEach(() => {
    getSpy.mockRestore();
  });

  it("calls GET /api/subscription/status and returns data", async () => {
    const mockStatus: SubscriptionStatus = {
      tier: "FREE",
      remainingQuota: 3,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };
    getSpy.mockResolvedValueOnce({ data: mockStatus });

    const result = await apiModule.getSubscriptionStatus();

    expect(getSpy).toHaveBeenCalledWith("/api/subscription/status");
    expect(result).toEqual(mockStatus);
  });

  it("returns PRO status with currentPeriodEnd", async () => {
    const mockStatus: SubscriptionStatus = {
      tier: "PRO",
      remainingQuota: -1,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: "2026-04-08T00:00:00Z",
    };
    getSpy.mockResolvedValueOnce({ data: mockStatus });

    const result = await apiModule.getSubscriptionStatus();
    expect(result.tier).toBe("PRO");
    expect(result.currentPeriodEnd).toBe("2026-04-08T00:00:00Z");
  });

  it("propagates API errors", async () => {
    getSpy.mockRejectedValueOnce(new Error("Network Error"));
    await expect(apiModule.getSubscriptionStatus()).rejects.toThrow("Network Error");
  });

  it("returns cancelAtPeriodEnd=true for cancelling subscribers", async () => {
    const mockStatus: SubscriptionStatus = {
      tier: "PRO",
      remainingQuota: -1,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: "2026-04-08T00:00:00Z",
    };
    getSpy.mockResolvedValueOnce({ data: mockStatus });

    const result = await apiModule.getSubscriptionStatus();
    expect(result.cancelAtPeriodEnd).toBe(true);
  });
});

describe("createCheckoutSession", () => {
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    postSpy = jest.spyOn(apiModule.api, "post");
  });

  afterEach(() => {
    postSpy.mockRestore();
  });

  it("calls POST /api/subscription/checkout and returns url", async () => {
    postSpy.mockResolvedValueOnce({ data: { url: "https://stripe.com/checkout/123" } });

    const result = await apiModule.createCheckoutSession();

    expect(postSpy).toHaveBeenCalledWith("/api/subscription/checkout");
    expect(result).toEqual({ url: "https://stripe.com/checkout/123" });
  });

  it("propagates API errors", async () => {
    postSpy.mockRejectedValueOnce(new Error("Stripe error"));
    await expect(apiModule.createCheckoutSession()).rejects.toThrow("Stripe error");
  });

  it("returns a string url field", async () => {
    postSpy.mockResolvedValueOnce({ data: { url: "https://stripe.com/pay" } });
    const result = await apiModule.createCheckoutSession();
    expect(typeof result.url).toBe("string");
  });
});

describe("createPortalSession", () => {
  let postSpy: jest.SpyInstance;

  beforeEach(() => {
    postSpy = jest.spyOn(apiModule.api, "post");
  });

  afterEach(() => {
    postSpy.mockRestore();
  });

  it("calls POST /api/subscription/portal and returns url", async () => {
    postSpy.mockResolvedValueOnce({ data: { url: "https://billing.stripe.com/portal/123" } });

    const result = await apiModule.createPortalSession();

    expect(postSpy).toHaveBeenCalledWith("/api/subscription/portal");
    expect(result).toEqual({ url: "https://billing.stripe.com/portal/123" });
  });

  it("propagates API errors", async () => {
    postSpy.mockRejectedValueOnce(new Error("Portal error"));
    await expect(apiModule.createPortalSession()).rejects.toThrow("Portal error");
  });

  it("returns a string url field", async () => {
    postSpy.mockResolvedValueOnce({ data: { url: "https://billing.stripe.com/p" } });
    const result = await apiModule.createPortalSession();
    expect(typeof result.url).toBe("string");
  });
});
