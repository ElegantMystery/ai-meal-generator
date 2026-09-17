"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/authStore";
import { api } from "@/lib/api";
import { streamMealPlan } from "@/lib/sse";
import { Button } from "@/components/ui/Button";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { PlusIcon } from "@heroicons/react/24/outline";
import { DashboardPreferences } from "@/components/dashboard/DashboardPreferences";
import { PlanComposer } from "@/components/dashboard/PlanComposer";
import {
  FeaturedPlan,
  PlanHistory,
  type BasketState,
} from "@/components/dashboard/DashboardPlans";
import {
  featuredPlan,
  sortedPlans,
  localDateKey,
} from "@/lib/dashboard-plan-utils";
import { useSubscription } from "@/hooks/useSubscription";
import QuotaBadge from "@/components/QuotaBadge";
import UpgradeModal from "@/components/UpgradeModal";
import GeneratingModal from "@/components/GeneratingModal";

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

type ActiveMealPlanGeneration = {
  idempotencyKey: string;
  requestId?: string;
  store?: StoreOption;
  days?: number;
  servings?: unknown;
};

type GenerationStatus = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABANDONED";
  failureCode: string | null;
  mealPlanId: number | null;
};

function recoveredServings(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 12
    ? value
    : 1;
}

function readActiveGeneration(): ActiveMealPlanGeneration | null {
  const raw = localStorage.getItem("activeMealPlanGeneration");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveMealPlanGeneration;
  } catch {
    return null;
  }
}

// Type guard for quota exceeded errors — handles both Axios and fetch/SSE error shapes
function isQuotaExceeded(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // Axios shape: err.response.status / err.response.data.error
  if ("response" in err) {
    const errObj = err as {
      response?: { status?: number; data?: { error?: string } };
    };
    if (
      (errObj.response?.status === 429 || errObj.response?.status === 403) &&
      errObj.response?.data?.error === "QUOTA_EXCEEDED"
    ) {
      return true;
    }
  }
  // fetch/SSE shape from sse.ts: err.status / err.body
  if ("status" in err && "body" in err) {
    const errObj = err as { status?: number; body?: string };
    if (
      (errObj.status === 429 || errObj.status === 403) &&
      typeof errObj.body === "string" &&
      errObj.body.includes("QUOTA_EXCEEDED")
    ) {
      return true;
    }
  }
  return false;
}

async function waitForGeneration(
  requestId: string,
  signal: AbortSignal,
): Promise<GenerationStatus> {
  const deadline = Date.now() + 2 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await api.get<GenerationStatus>(
      `/api/mealplans/generation-requests/${requestId}`,
      { signal },
    );
    if (
      response.data.status === "SUCCEEDED" ||
      response.data.status === "FAILED" ||
      response.data.status === "ABANDONED"
    ) {
      return response.data;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timeout = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, 1500);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw new Error("Generation status recovery timed out");
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
  const [prefsError, setPrefsError] = useState(false);
  const [plansError, setPlansError] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [basket, setBasket] = useState<{
    planId: number;
    value: BasketState;
  } | null>(null);

  const [mealplans, setMealplans] = useState<MealPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  const [creatingAi, setCreatingAi] = useState(false);
  const [aiStatus, setAiStatus] = useState<string>("");
  const [aiProgress, setAiProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const [store, setStore] = useState<StoreOption>("TRADER_JOES");
  const [days, setDays] = useState<number>(7);
  const [servings, setServings] = useState<number>(1);

  const abortControllerRef = useRef<AbortController | null>(null);
  const generationKeyRef = useRef<string | null>(null);
  const generationStatusRef = useRef<GenerationStatus | null>(null);
  const recoveryHandledRef = useRef(false);

  // Cancel any in-flight SSE stream when the component unmounts
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // A page refresh or lost SSE connection must not make the result unknowable.
  // Resume from the durable backend request and load the saved plan when ready.
  useEffect(() => {
    if (recoveryHandledRef.current) return;
    recoveryHandledRef.current = true;
    const raw = localStorage.getItem("activeMealPlanGeneration");
    if (!raw) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const active = JSON.parse(raw) as ActiveMealPlanGeneration;
        setServings(recoveredServings(active.servings));
        generationKeyRef.current = active.idempotencyKey;
        setCreatingAi(true);
        setAiStatus("Recovering your meal plan…");
        const initial = active.requestId
          ? null
          : (
              await api.get<GenerationStatus>(
                "/api/mealplans/generation-requests",
                {
                  params: { idempotencyKey: active.idempotencyKey },
                  signal: controller.signal,
                },
              )
            ).data;
        const requestId = active.requestId ?? initial?.id;
        if (!requestId) throw new Error("Generation request was not created");
        const status =
          initial?.status === "SUCCEEDED" ||
          initial?.status === "FAILED" ||
          initial?.status === "ABANDONED"
            ? initial
            : await waitForGeneration(requestId, controller.signal);
        if (status.status === "SUCCEEDED" && status.mealPlanId) {
          const plan = (
            await api.get<MealPlan>(`/api/mealplans/${status.mealPlanId}`)
          ).data;
          setMealplans((previous) =>
            previous.some((candidate) => candidate.id === plan.id)
              ? previous
              : [plan, ...previous],
          );
          await refetchSubscription();
        } else {
          setError("The previous AI meal-plan generation did not complete.");
        }
        generationKeyRef.current = null;
        localStorage.removeItem("activeMealPlanGeneration");
      } catch (recoveryError) {
        if (
          !(
            recoveryError instanceof Error &&
            recoveryError.name === "AbortError"
          )
        ) {
          setError("Unable to recover the previous AI meal-plan generation.");
        }
      } finally {
        setCreatingAi(false);
        setAiStatus("");
      }
    })();

    return () => controller.abort();
  }, [refetchSubscription]);

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

  const today = localDateKey();
  const featured = useMemo(
    () => featuredPlan(mealplans, today),
    [mealplans, today],
  );
  const history = useMemo(
    () => sortedPlans(mealplans).filter((plan) => plan.id !== featured?.id),
    [mealplans, featured?.id],
  );
  const featuredId = featured?.id;
  const showComposer = !featured || composerOpen;
  const preferences = (
    <DashboardPreferences
      prefs={prefs}
      state={loadingPrefs ? "loading" : prefsError ? "error" : "ready"}
    />
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoadingPrefs(true);
    setPrefsError(false);
    api
      .get<PreferencesDto>("/api/preferences/me", { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setPrefs(res.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPrefsError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPrefs(false);
      });
    return () => controller.abort();
  }, [preferencesVersion]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get<MealPlan[]>("/api/mealplans", { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        // Preserve a plan recovered or generated while this request was in flight.
        setMealplans((previous) => [
          ...previous,
          ...(res.data || []).filter(
            (plan) => !previous.some((existing) => existing.id === plan.id),
          ),
        ]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPlansError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPlans(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (featuredId === undefined) return;
    const controller = new AbortController();
    const planId = featuredId;
    api
      .get<{
        estimatedTotal?: number;
        items?: { price?: number | null; lineTotal?: number | null }[];
      }>(`/api/mealplans/${planId}/shopping-list`, {
        signal: controller.signal,
      })
      .then((res) => {
        if (controller.signal.aborted) return;
        const total = res.data?.estimatedTotal;
        const items = res.data?.items;
        // The API total omits unpriced lines and returns zero for empty plans.
        // Only describe it as a full-plan estimate when every line is priced.
        const fullyPriced =
          Array.isArray(items) &&
          items.length > 0 &&
          items.every(
            (item) =>
              item != null &&
              typeof item.price === "number" &&
              Number.isFinite(item.price) &&
              item.price >= 0 &&
              typeof item.lineTotal === "number" &&
              Number.isFinite(item.lineTotal) &&
              item.lineTotal >= 0,
          );
        setBasket({
          planId,
          value: {
            state: "ready",
            total:
              fullyPriced &&
              typeof total === "number" &&
              Number.isFinite(total) &&
              total >= 0
                ? total
                : null,
          },
        });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setBasket({ planId, value: { state: "error" } });
      });
    return () => controller.abort();
  }, [featuredId]);

  const generateMealPlanAi = async () => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setCreatingAi(true);
    setAiStatus("Connecting to the planner…");
    setAiProgress(0);
    setError(null);

    // Heuristic progress: each tool call nudges the bar forward up to 89 %.
    let toolCalls = 0;
    let saved: MealPlan | null = null;
    generationStatusRef.current = null;
    const durableGeneration = readActiveGeneration();
    const reusableKey = generationKeyRef.current;
    const canReuseKey =
      reusableKey !== null &&
      durableGeneration?.idempotencyKey === reusableKey &&
      durableGeneration.store === store &&
      durableGeneration.days === days &&
      durableGeneration.servings === servings;
    const idempotencyKey = canReuseKey ? reusableKey : crypto.randomUUID();
    generationKeyRef.current = idempotencyKey;
    localStorage.setItem(
      "activeMealPlanGeneration",
      JSON.stringify({ idempotencyKey, store, days, servings }),
    );

    try {
      await streamMealPlan({
        store,
        days,
        servings,
        idempotencyKey,
        signal: controller.signal,
        onEvent: (ev) => {
          const data = (ev.data ?? {}) as {
            phase?: string;
            message?: string;
            name?: string;
            summary?: string;
            code?: string;
          };

          switch (ev.event) {
            case "generation_status":
              generationStatusRef.current = ev.data as GenerationStatus;
              localStorage.setItem(
                "activeMealPlanGeneration",
                JSON.stringify({
                  idempotencyKey,
                  requestId: generationStatusRef.current.id,
                  store,
                  days,
                  servings,
                }),
              );
              break;
            case "phase":
              if (data.message) setAiStatus(data.message);
              break;
            case "tool_call":
              toolCalls += 1;
              setAiProgress(Math.min(89, 10 + toolCalls * 5));
              if (data.name) setAiStatus(`Calling ${data.name}…`);
              break;
            case "tool_result":
              if (data.summary) setAiStatus(`${data.name}: ${data.summary}`);
              break;
            case "assistant_text":
              // intentionally ignored — keeps the modal calm
              break;
            case "complete":
              setAiProgress(95);
              setAiStatus("Saving your meal plan…");
              break;
            case "mealplan_saved":
              saved = ev.data as MealPlan;
              setAiProgress(100);
              setAiStatus("Done!");
              break;
            case "error":
              throw new Error(
                data.message ?? `Agent error (${data.code ?? "unknown"})`,
              );
          }
        },
      });

      // The SSE callback mutates the ref asynchronously; keep the explicit union
      // because TypeScript cannot infer callback side effects across the await.
      const generation = generationStatusRef.current as GenerationStatus | null;
      if (!saved && generation) {
        const recovered = await waitForGeneration(
          generation.id,
          controller.signal,
        );
        if (recovered.status === "SUCCEEDED" && recovered.mealPlanId) {
          saved = (
            await api.get<MealPlan>(`/api/mealplans/${recovered.mealPlanId}`)
          ).data;
        } else if (
          recovered.status === "FAILED" ||
          recovered.status === "ABANDONED"
        ) {
          generationKeyRef.current = null;
          localStorage.removeItem("activeMealPlanGeneration");
          throw new Error(recovered.failureCode ?? "Generation failed");
        }
      }

      if (saved) {
        setMealplans((prev) => [saved as MealPlan, ...prev]);
        generationKeyRef.current = null;
        localStorage.removeItem("activeMealPlanGeneration");
        await refetchSubscription();
      } else {
        throw new Error("Stream ended without a saved meal plan");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (isQuotaExceeded(err)) {
        setShowUpgradeModal(true);
      } else {
        setError("Failed to generate AI meal plan.");
      }
    } finally {
      abortControllerRef.current = null;
      setCreatingAi(false);
      setAiStatus("");
      setAiProgress(0);
    }
  };

  return (
    <main className="max-w-6xl mx-auto py-8 px-4 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500">
            Welcome back, {user?.name || "friend"}
          </p>
          <h1 className="mt-1 font-brand text-3xl text-brand-900">
            A little planning. Better meals.
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {subscriptionStatus && (
            <QuotaBadge
              tier={subscriptionStatus.tier}
              remainingQuota={subscriptionStatus.remainingQuota}
            />
          )}
          {featured && (
            <Button
              variant="secondary"
              className="min-h-11"
              aria-expanded={showComposer}
              aria-controls="new-plan-composer"
              onClick={() => setComposerOpen(!composerOpen)}
            >
              <PlusIcon aria-hidden="true" className="h-4 w-4" />
              {showComposer ? "Hide composer" : "New plan"}
            </Button>
          )}
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3"
        >
          {error}
        </div>
      )}
      {plansError && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          Unable to load saved plans. Please refresh to try again.
        </p>
      )}
      {showComposer && (
        <PlanComposer
          store={store}
          days={days}
          servings={servings}
          busy={creatingAi}
          onStoreChange={setStore}
          onDaysChange={setDays}
          onServingsChange={setServings}
          onGenerate={generateMealPlanAi}
          preferences={preferences}
        />
      )}
      {!showComposer && (
        <div className="rounded-xl border border-surface-200 bg-white px-5 py-3">
          {preferences}
        </div>
      )}
      {loadingPlans && !featured ? (
        <div role="status" aria-label="Loading saved plans">
          <SkeletonCard />
        </div>
      ) : featured ? (
        <FeaturedPlan
          key={featured.id}
          plan={featured}
          today={today}
          basket={
            basket?.planId === featured.id ? basket.value : { state: "loading" }
          }
        />
      ) : (
        !plansError && (
          <p className="text-center text-sm text-gray-500">
            No meal plans yet. Your first haul starts here.
          </p>
        )
      )}
      <PlanHistory plans={history} />
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
      <GeneratingModal
        isOpen={creatingAi}
        status={aiStatus}
        progressPercent={creatingAi ? aiProgress : undefined}
      />
    </main>
  );
}
