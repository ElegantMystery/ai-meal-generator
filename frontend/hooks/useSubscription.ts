"use client";

import { useState, useEffect, useCallback } from "react";
import { getSubscriptionStatus, SubscriptionStatus } from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";

interface UseSubscriptionResult {
  status: SubscriptionStatus | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const setUser = useAuthStore((s) => s.setUser);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSubscriptionStatus();
      setStatus(data);
    } catch (err) {
      const statusCode = (err as { response?: { status?: number } })?.response
        ?.status;
      if (statusCode === 401) {
        setUser(null);
        return;
      }
      console.error("Failed to fetch subscription status:", err);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { status, loading, refetch: fetchStatus };
}
