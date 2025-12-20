"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/lib/authStore";
import { api } from "@/lib/api";

type PreferencesDto = {
  dietaryRestrictions: string | null;
  dislikedIngredients: string | null;
  targetCaloriesPerDay: number | null;
} | null;

type MealPlan = {
  id: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  planJson: string | null;
  createdAt: string | null; // ISO
};

type StoreOption = "TRADER_JOES" | "COSTCO";

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return "No date range";
  if (start && !end) return `From ${start}`;
  if (!start && end) return `Until ${end}`;
  return `${start} → ${end}`;
}

function formatCreatedAt(iso: string | null) {
  if (!iso) return "";
  // Keep it simple + stable (no timezone weirdness). You can prettify later.
  return iso.replace("T", " ").replace("Z", " UTC");
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  const [prefs, setPrefs] = useState<PreferencesDto>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(true);

  const [mealplans, setMealplans] = useState<MealPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [store, setStore] = useState<StoreOption>("TRADER_JOES");
  const [days, setDays] = useState<number>(7);

  const prefsSummary = useMemo(() => {
    if (!prefs) return null;
    const parts: string[] = [];
    if (prefs.targetCaloriesPerDay != null) parts.push(`🎯 ${prefs.targetCaloriesPerDay} cal/day`);
    if (prefs.dietaryRestrictions) parts.push(`🥗 ${prefs.dietaryRestrictions}`);
    if (prefs.dislikedIngredients) parts.push(`🚫 ${prefs.dislikedIngredients}`);
    return parts.length ? parts.join(" · ") : "No preferences set yet.";
  }, [prefs]);

  useEffect(() => {
    const load = async () => {
      setError(null);

      // Preferences
      setLoadingPrefs(true);
      api
        .get<PreferencesDto>("/api/preferences/me")
        .then((res) => setPrefs(res.data))
        .catch((err) => {
          console.error("Failed to load preferences:", err);
          setError((prev) => prev ?? "Failed to load preferences.");
        })
        .finally(() => setLoadingPrefs(false));

      // Meal plans
      setLoadingPlans(true);
      api
        .get<MealPlan[]>("/api/mealplans")
        .then((res) => setMealplans(res.data || []))
        .catch((err) => {
          console.error("Failed to load meal plans:", err);
          setError((prev) => prev ?? "Failed to load meal plans.");
        })
        .finally(() => setLoadingPlans(false));
    };

    load();
  }, []);

  const generateMealPlan = async () => {
    setCreating(true);
    setError(null);

    try {
      const res = await api.post<MealPlan>("/api/mealplans/generate", null, {
        params: {store,days},
      });
      setMealplans((prev) => [res.data, ...prev]);
    } catch (err) {
      console.error("Failed to generate meal plan:", err);
      setError("Failed to generate meal plan.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-10 px-4 space-y-6">
        {/* Title */}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-gray-700">
            Welcome,{" "}
            <span className="font-semibold">{user?.name || user?.email || "friend"}</span>!
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        {/* Row 1: Preferences + Actions */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Preferences card */}
          <div className="bg-white rounded-xl shadow-sm border p-6 lg:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium text-gray-900">Your Preferences</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Used to personalize meal plans and recommendations.
                </p>
              </div>
              <a
                href="/settings"
                className="text-sm font-medium text-blue-600 hover:text-blue-700 transition"
              >
                Edit
              </a>
            </div>

            <div className="mt-4">
              {loadingPrefs ? (
                <p className="text-sm text-gray-500">Loading preferences…</p>
              ) : prefsSummary ? (
                <p className="text-sm text-gray-700">{prefsSummary}</p>
              ) : (
                <p className="text-sm text-gray-500">
                  No preferences set. Go to <a className="text-blue-600 hover:underline" href="/settings">Settings</a>.
                </p>
              )}
            </div>
          </div>

          {/* Action card */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-medium text-gray-900">Quick Actions</h2>
            <p className="text-sm text-gray-600 mt-1">Create a plan to test the flow.</p>

            {/* Store and days selector */}
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Store</label>
                <select
                  value={store}
                  onChange={(e) => setStore(e.target.value as StoreOption)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={creating}
                >
                  <option value="TRADER_JOES">Trader Joe&apos;s</option>
                  <option value="COSTCO">Costco</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Days</label>
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={creating}
                >
                  <option value={3}>3 days</option>
                  <option value={5}>5 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                </select>
              </div>
            </div>

            <button
              onClick={generateMealPlan}
              disabled={creating}
              className="mt-4 w-full inline-flex justify-center items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {creating ? "Creating..." : "Generate Meal Plan"}
            </button>

            <p className="mt-3 text-xs text-gray-500">
              Next: replace this with a real “Generate” endpoint using Trader Joe’s items + preferences.
            </p>
          </div>
        </section>

        {/* Meal plans list */}
        <section className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">My Meal Plans</h2>
              <p className="text-sm text-gray-600 mt-1">
                Your saved meal plans (latest first).
              </p>
            </div>
          </div>

          <div className="mt-4">
            {loadingPlans ? (
              <p className="text-sm text-gray-500">Loading meal plans…</p>
            ) : mealplans.length === 0 ? (
              <div className="rounded-md bg-blue-50 border border-blue-200 text-blue-700 p-3 text-sm">
                No meal plans yet. Click <span className="font-medium">Generate Meal Plan</span> to test.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {mealplans.map((p) => (
                  <li key={p.id} className="py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <a
                          href={`/mealplans/${p.id}`}
                          className="text-sm font-semibold text-gray-900 hover:underline"
                        >
                          {p.title}
                        </a>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatDateRange(p.startDate, p.endDate)}
                          {p.createdAt ? ` · Created: ${formatCreatedAt(p.createdAt)}` : ""}
                        </p>
                      </div>

                      <a
                        href={`/mealplans/${p.id}`}
                        className="text-sm text-blue-600 hover:text-blue-700 transition"
                      >
                        View →
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
