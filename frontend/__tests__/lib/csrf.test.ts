import { api } from "@/lib/api";
import { streamMealPlan } from "@/lib/sse";

describe("CSRF browser integration", () => {
  test("Axios sends XSRF tokens for credentialed cross-origin development requests", () => {
    expect(api.defaults.withCredentials).toBe(true);
    expect(api.defaults.withXSRFToken).toBe(true);
  });

  test("SSE generation sends the cookie token in the CSRF header", async () => {
    document.cookie = "XSRF-TOKEN=test-token; path=/";
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: null,
    } as Response);
    global.fetch = fetchMock;

    await expect(streamMealPlan({
      store: "TRADER_JOES",
      days: 3,
      idempotencyKey: "test-key",
      correlationId: "00000000-0000-4000-8000-000000000001",
      onEvent: jest.fn(),
    })).rejects.toThrow("generate-ai response has no body");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-XSRF-TOKEN": "test-token",
          "X-Correlation-ID": "00000000-0000-4000-8000-000000000001",
        }),
      })
    );
    delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch;
  });
});
