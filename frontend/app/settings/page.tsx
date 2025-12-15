"use client";

import { useAuthStore } from "@/lib/authStore";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";


type PreferencesDto = {
  dietaryRestrictions: string | null;
  dislikedIngredients: string | null;
  targetCaloriesPerDay: number | null;
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dietaryRestrictions, setDietaryRestrictions] = useState<string>("");
  const [dislikedIngredients, setDislikedIngredients] = useState<string>("");
  const [targetCaloriesPerDay, setTargetCaloriesPerDay] = useState<string>("");

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get<PreferencesDto | null>("/api/preferences/me");
        const prefs = res.data;

        setDietaryRestrictions(prefs?.dietaryRestrictions ?? "");
        setDislikedIngredients(prefs?.dislikedIngredients ?? "");
        setTargetCaloriesPerDay(
          prefs?.targetCaloriesPerDay != null ? String(prefs.targetCaloriesPerDay) : ""
        );
      } catch (err: any) {
        if (err?.response?.status === 401) {
          router.push("/login");
          return;
        }
        console.error("Failed to load user preferences:", err);
        setMessage({ type: "error", text: "Failed to load user preferences" });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [router]);

  const onSave = async () => {
    setSaving(true);
    setMessage(null);

    // Normalize input
    const payload: PreferencesDto = {
      dietaryRestrictions: dietaryRestrictions.trim() ? dietaryRestrictions.trim() : null,
      dislikedIngredients: dislikedIngredients.trim() ? dislikedIngredients.trim() : null,
      targetCaloriesPerDay: targetCaloriesPerDay.trim()
        ? Number(targetCaloriesPerDay.trim())
        : null,
    };

    // Basic validation
    if (payload.targetCaloriesPerDay != null && Number.isNaN(payload.targetCaloriesPerDay)) {
      setSaving(false);
      setMessage({ type: "error", text: "Target calories must be a number." });
      return;
    }

    try {
      await api.put("/api/preferences/me", payload);
      setMessage({ type: "success", text: "Preferences saved!" });
    } catch (err: any) {
      if (err?.response?.status === 401) {
        router.push("/login");
        return;
      }
      console.error("Failed to save preferences:", err);
      setMessage({ type: "error", text: "Failed to save preferences." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Back link */}
      <div className="max-w-4xl mx-auto px-4 pt-6">
        <a
          href="/dashboard"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 transition"
        >
          ← Back to Dashboard
        </a>
      </div>

      <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-600 mt-1">
              Personalize your meal recommendations.
            </p>
          </div>

          <button
            onClick={onSave}
            disabled={loading || saving}
            className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>

        {/* Message */}
        {message && (
          <div
            className={`rounded-md border p-3 text-sm ${
              message.type === "success"
                ? "bg-green-50 border-green-200 text-green-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Account */}
        <section className="bg-white rounded-xl shadow-sm border p-6 space-y-1">
          <h2 className="text-lg font-medium text-gray-800">Account</h2>
          <p className="text-sm text-gray-600">Signed in details</p>

          <div className="mt-4 space-y-1 text-sm text-gray-700">
            <p>
              <span className="font-medium">Name:</span> {user?.name || "N/A"}
            </p>
            <p>
              <span className="font-medium">Email:</span> {user?.email || "N/A"}
            </p>
            <p>
              <span className="font-medium">Provider:</span> {user?.provider || "google"}
            </p>
          </div>
        </section>

        {/* Preferences */}
        <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
          <div>
            <h2 className="text-lg font-medium text-gray-800">Preferences</h2>
            <p className="text-sm text-gray-600">
              Use semicolons or commas (e.g. <span className="font-medium">no pork; high-protein</span>).
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading preferences…</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Dietary Restrictions
                </label>
                <input
                  value={dietaryRestrictions}
                  onChange={(e) => setDietaryRestrictions(e.target.value)}
                  placeholder="e.g. vegetarian; no pork; high-protein"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Disliked Ingredients
                </label>
                <input
                  value={dislikedIngredients}
                  onChange={(e) => setDislikedIngredients(e.target.value)}
                  placeholder="e.g. cilantro; blue cheese"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Target Calories Per Day
                </label>
                <input
                  value={targetCaloriesPerDay}
                  onChange={(e) => setTargetCaloriesPerDay(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 2000"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Optional — leave blank if you don&apos;t have a target yet.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Hint */}
        <section className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-medium text-gray-800 mb-1">Next</h2>
          <p className="text-sm text-gray-600">
            Week 2 will use these preferences to generate your first meal plan.
          </p>
        </section>
      </div>
    </main>
  );
}
