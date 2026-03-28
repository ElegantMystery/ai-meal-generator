"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/authStore";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { SkeletonCard, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { CalendarDaysIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { formatDateRange, formatCreatedAt } from "@/lib/formatters";
import { useSubscription } from "@/hooks/useSubscription";
import QuotaBadge from "@/components/QuotaBadge";
import UpgradeModal from "@/components/UpgradeModal";

type PreferencesDto = {
  dietaryRestrictions: string | null;
  allergies: string | null;
  targetCaloriesPerDay: number | null;
} | null;

type MealPlan = {
  id: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  planJson: string | null;
  createdAt: string | null;
};

type StoreOption = "TRADER_JOES" | "WHOLE_FOODS";

// Type guard for quota exceeded errors
function isQuotaExceeded(err: unknown): boolean {
  if (err && typeof err === "object" && "response" in err) {
    const errObj = err as {
      response?: { status?: number; data?: { error?: string } };
    };
    return (
      errObj.response?.status === 403 &&
      errObj.response?.data?.error === "QUOTA_EXCEEDED"
    );
  }
  return false;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const preferencesVersion = useAuthStore((s) => s.preferencesVersion);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { status: subscriptionStatus, refetch: refetchSubscription } =
    useSubscription();

  const [prefs, setPrefs] = useState<PreferencesDto>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(true);

  const [mealplans, setMealplans] = useState<MealPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  const [creating, setCreating] = useState(false);
  const [creatingAi, setCreatingAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const [store, setStore] = useState<StoreOption>("TRADER_JOES");
  const [days, setDays] = useState<number>(7);

  // Handle ?upgrade=success — poll for PRO status until webhook is processed
  const upgradeHandledRef = useRef(false);

  useEffect(() => {
    if (upgradeHandledRef.current) return;
    if (searchParams.get("upgrade") !== "success") return;

    upgradeHandledRef.current = true;
    router.replace("/dashboard");

    let attempts = 0;
    const MAX_ATTEMPTS = 8;
    const INTERVAL_MS = 1500;

    const poll = () => {
      refetchSubscription();
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Webhook still hasn't fired — show a softer message and stop polling
        toast("Upgrade successful! Your plan will update shortly.", "success");
      }
    };

    poll();
    const interval = setInterval(() => {
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(interval);
        return;
      }
      poll();
    }, INTERVAL_MS);

    return () => clearInterval(interval);
  }, [searchParams, router, refetchSubscription, toast]);

  // Fire the "Welcome to PRO" toast once polled status confirms PRO
  const proBadgeFiredRef = useRef(false);
  useEffect(() => {
    if (
      !proBadgeFiredRef.current &&
      subscriptionStatus?.tier === "PRO" &&
      upgradeHandledRef.current
    ) {
      proBadgeFiredRef.current = true;
      toast("Welcome to PRO! You now have unlimited meal plans.", "success");
    }
  }, [subscriptionStatus, toast]);

  const prefsSummary = useMemo(() => {
    if (!prefs) return null;
    const parts: string[] = [];
    if (prefs.targetCaloriesPerDay != null)
      parts.push(`🎯 ${prefs.targetCaloriesPerDay} cal/day`);
    if (prefs.dietaryRestrictions) {
      const style = prefs.dietaryRestrictions
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("-");
      parts.push(`🥗 ${style}`);
    }
    if (prefs.allergies) {
      const list = prefs.allergies
        .split(";")
        .map((a) => a.trim())
        .join(", ");
      parts.push(`⚠️ Allergies: ${list}`);
    }
    return parts.length ? parts.join(" · ") : null;
  }, [prefs]);

  useEffect(() => {
    setLoadingPrefs(true);
    api
      .get<PreferencesDto>("/api/preferences/me")
      .then((res) => setPrefs(res.data))
      .catch((err) => {
        console.error("Failed to load preferences:", err);
        setError((prev) => prev ?? "Failed to load preferences.");
      })
      .finally(() => setLoadingPrefs(false));
  }, [preferencesVersion]);

  useEffect(() => {
    setLoadingPlans(true);
    api
      .get<MealPlan[]>("/api/mealplans")
      .then((res) => setMealplans(res.data || []))
      .catch((err) => {
        console.error("Failed to load meal plans:", err);
        setError((prev) => prev ?? "Failed to load meal plans.");
      })
      .finally(() => setLoadingPlans(false));
  }, []);

  const generateMealPlan = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<MealPlan>("/api/mealplans/generate", null, {
        params: { store, days },
      });
      setMealplans((prev) => [res.data, ...prev]);
      await refetchSubscription();
    } catch (err) {
      console.error("Failed to generate meal plan:", err);
      if (isQuotaExceeded(err)) {
        setShowUpgradeModal(true);
      } else {
        setError("Failed to generate meal plan.");
      }
    } finally {
      setCreating(false);
    }
  };

  const generateMealPlanAi = async () => {
    setCreatingAi(true);
    setError(null);
    try {
      const res = await api.post<MealPlan>("/api/mealplans/generate-ai", null, {
        params: { store, days },
      });
      setMealplans((prev) => [res.data, ...prev]);
      await refetchSubscription();
    } catch (err) {
      console.error("Failed to generate AI meal plan:", err);
      if (isQuotaExceeded(err)) {
        setShowUpgradeModal(true);
      } else {
        setError("Failed to generate AI meal plan.");
      }
    } finally {
      setCreatingAi(false);
    }
  };

  return (
    <main className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">
          Welcome back,{" "}
          <span className="font-medium text-gray-700">
            {user?.name || user?.email || "friend"}
          </span>
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Row 1: Preferences + Generate */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Preferences card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>Your Preferences</CardTitle>
                <CardDescription>
                  Used to personalize your meal plans.
                </CardDescription>
              </div>
              <Link
                href="/settings"
                className="text-sm font-medium text-brand-600 hover:text-brand-700 transition"
              >
                Edit
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {loadingPrefs ? (
              <SkeletonText lines={2} />
            ) : prefsSummary ? (
              <p className="text-sm text-gray-700">{prefsSummary}</p>
            ) : (
              <p className="text-sm text-gray-400">
                No preferences set.{" "}
                <Link
                  href="/settings"
                  className="text-brand-600 hover:underline"
                >
                  Add them in Settings.
                </Link>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Generate card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Generate Plan</CardTitle>
                <CardDescription>Pick a store and duration.</CardDescription>
              </div>
              {subscriptionStatus && (
                <QuotaBadge
                  tier={subscriptionStatus.tier}
                  remainingQuota={subscriptionStatus.remainingQuota}
                />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Select
                id="store"
                label="Store"
                value={store}
                onChange={(e) => setStore(e.target.value as StoreOption)}
                disabled={creating || creatingAi}
              >
                <option value="TRADER_JOES">Trader Joe&apos;s</option>
                <option value="WHOLE_FOODS">Whole Foods</option>
              </Select>

              <Select
                id="days"
                label="Duration"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                disabled={creating || creatingAi}
              >
                <option value={3}>3 days</option>
                <option value={5}>5 days</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
              </Select>

              <div className="pt-1 space-y-2">
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={generateMealPlanAi}
                  disabled={creatingAi || creating}
                  loading={creatingAi}
                >
                  <SparklesIcon className="h-4 w-4" />
                  {creatingAi ? "Generating…" : "Generate with AI"}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={generateMealPlan}
                  disabled={creating || creatingAi}
                  loading={creating}
                >
                  {creating ? "Generating…" : "Generate (Rule-based)"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Meal plans list */}
      <Card>
        <CardHeader>
          <CardTitle>My Meal Plans</CardTitle>
          <CardDescription>Your saved plans, latest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingPlans ? (
            <SkeletonCard className="border-0 shadow-none p-0" />
          ) : mealplans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <CalendarDaysIcon className="h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">
                No meal plans yet. Generate your first one above.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {mealplans.map((p) => (
                <li key={p.id} className="py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/mealplans/${p.id}`}
                          className="text-sm font-semibold text-gray-900 hover:text-brand-600 transition"
                        >
                          {p.title}
                        </Link>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatDateRange(p.startDate, p.endDate)}
                        {p.createdAt
                          ? ` · ${formatCreatedAt(p.createdAt)}`
                          : ""}
                      </p>
                    </div>
                    <Link
                      href={`/mealplans/${p.id}`}
                      className="text-sm font-medium text-brand-600 hover:text-brand-700 transition shrink-0"
                    >
                      View →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Upgrade Modal */}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </main>
  );
}
