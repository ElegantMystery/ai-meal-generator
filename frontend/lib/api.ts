import axios from "axios";

export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
});

export type SubscriptionStatus = {
  tier: "FREE" | "PRO";
  remainingQuota: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
};

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const res = await api.get<SubscriptionStatus>("/api/subscription/status");
  return res.data;
}

export async function createCheckoutSession(): Promise<{ url: string }> {
  const res = await api.post<{ url: string }>("/api/subscription/checkout");
  return res.data;
}

export async function createPortalSession(): Promise<{ url: string }> {
  const res = await api.post<{ url: string }>("/api/subscription/portal");
  return res.data;
}
