"use client";

import { api } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";

type MealPlan = {
  id: number;
  title: string;
  startDate: string | null;
  endDate: string | null;
  planJson: string | null;
  createdAt: string | null;
};

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return "No date range";
  if (start && !end) return `From ${start}`;
  if (!start && end) return `Until ${end}`;
  return `${start} → ${end}`;
}

function formatCreatedAt(iso: string | null) {
  if (!iso) return "";
  return iso.replace("T", " ").replace("Z", " UTC");
}

export default function MealPlanDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const id = params?.id;

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await api.get<MealPlan>(`/api/mealplans/${id}`);
        setPlan(res.data);
      } catch (err: any) {
        if (err?.response?.status === 401) {
          router.push("/login");
          return;
        }
        if (err?.response?.status === 404) {
          setError("Meal plan not found.");
          return;
        }
        console.error("Failed to load meal plan:", err);
        setError("Failed to load meal plan.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, router]);

  const handleDelete = async () => {
    if (!id) return;
  
    const ok = window.confirm("Delete this meal plan? This cannot be undone.");
    if (!ok) return;
  
    setDeleting(true);
    setError(null);
  
    try {
      await api.delete(`/api/mealplans/${id}`);
      router.push("/dashboard");
    } catch (err: any) {
      if (err?.response?.status === 401) {
        router.push("/login");
        return;
      }
      console.error("Failed to delete meal plan:", err);
      setError("Failed to delete meal plan.");
    } finally {
      setDeleting(false);
    }
  };

  const prettyPlanJson = useMemo(() => {
    if (!plan?.planJson) return null;
    try {
      const parsed = JSON.parse(plan.planJson);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return plan.planJson; // not valid JSON, display raw
    }
  }, [plan?.planJson]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto py-10 px-4">
          <p className="text-sm text-gray-600">Loading meal plan…</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto py-10 px-4 space-y-4">
          <a
            href="/dashboard"
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 transition"
          >
            ← Back to Dashboard
          </a>

          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h1 className="text-xl font-semibold text-gray-900">Meal Plan</h1>
            <p className="text-sm text-red-700 mt-2">{error}</p>
          </div>
        </div>
      </main>
    );
  }

  if (!plan) return null;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto py-10 px-4 space-y-6">
        <div className="flex items-center justify-between">
          <a
            href="/dashboard"
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 transition"
          >
            ← Back to Dashboard
          </a>
        </div>

        <header className="bg-white rounded-xl shadow-sm border p-6 space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">{plan.title}</h1>

          <div className="text-sm text-gray-600">
            <div>{formatDateRange(plan.startDate, plan.endDate)}</div>
            {plan.createdAt && (
              <div className="mt-1">Created: {formatCreatedAt(plan.createdAt)}</div>
            )}

            <button
              onClick={handleDelete}
              disabled={deleting}
              className="shrink-0 inline-flex items-center px-3 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </header>

        <section className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-medium text-gray-900">Plan JSON</h2>
          <p className="text-sm text-gray-600 mt-1">
            MVP view (raw JSON). We’ll render this into a calendar/grid next.
          </p>

          <pre className="mt-4 whitespace-pre-wrap break-words rounded-md bg-gray-50 border p-4 text-xs text-gray-800 overflow-auto">
            {prettyPlanJson ?? "(No plan data)"}
          </pre>
        </section>
      </div>
    </main>
  );
}
