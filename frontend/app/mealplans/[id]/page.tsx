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

type ShoppingListItem = {
  id: number;
  name: string;
  qty: number;
  price?: number | null;
  unitSize?: string | null;
  imageUrl?: string | null;
  lineTotal?: number | null;
};

type ShoppingListResponse = {
  mealplanId: number;
  store?: string | null;
  items: ShoppingListItem[];
  estimatedTotal: number;
  caloriesPerDay?: number | null;
  fatPerDay?: number | null;
  proteinPerDay?: number | null;
  carbohydratesPerDay?: number | null;
  sodiumPerDay?: number | null;
  fiberPerDay?: number | null;
  sugarPerDay?: number | null;
};

type PlanItem = { id: number; name: string };
type PlanMeal = { name: string; items: PlanItem[] };
type PlanDay = { date: string; meals: PlanMeal[] };
type PlanDoc = {
  title?: string;
  startDate?: string;
  endDate?: string;
  plan: PlanDay[];
};

function safeParsePlanJson(planJson: string | null): { doc: PlanDoc | null; error?: string } {
  if (!planJson) return { doc: null };
  try {
    const parsed = JSON.parse(planJson);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.plan)) {
      return { doc: null, error: "Plan JSON has unexpected shape." };
    }
    return { doc: parsed as PlanDoc };
  } catch {
    return { doc: null, error: "Plan JSON is not valid JSON." };
  }
}

function formatDayLabel(dateStr: string) {
  // dateStr is like "2025-12-25"
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function normalizeMealName(name: string) {
  const n = (name || "").toLowerCase();
  if (n.includes("break")) return "Breakfast";
  if (n.includes("lunch")) return "Lunch";
  if (n.includes("dinner")) return "Dinner";
  return name || "Meal";
}


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
  const [shopping, setShopping] = useState<ShoppingListResponse | null>(null);
  const [shoppingLoading, setShoppingLoading] = useState(false);
  const [shoppingError, setShoppingError] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

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

  useEffect(() => {
    const fetchShopping = async () => {
      setShoppingLoading(true);
      setShoppingError(null);
      try {
        const res = await api.get<ShoppingListResponse>(`/api/mealplans/${id}/shopping-list`);
        setShopping(res.data);
      } catch (e) {
        console.error(e);
        setShoppingError("Failed to load shopping list.");
      } finally {
        setShoppingLoading(false);
      }
    };
  
    if (id) fetchShopping();
  }, [id]);

  const findShoppingItem = (itemId: number) => {
    return shopping?.items?.find((x) => x.id === itemId) ?? null;
  };
  

  const copyShoppingList = async () => {
    if (!shopping) return;
    const lines = shopping.items.map((it) => {
      const priceStr = it.price != null ? ` ($${it.price.toFixed(2)})` : "";
      const unitStr = it.unitSize ? ` - ${it.unitSize}` : "";
      return `${it.qty}x ${it.name}${unitStr}${priceStr}`;
    });
    const text = lines.join("\n");
    await navigator.clipboard.writeText(text);
    alert("Shopping list copied!");
  };

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

  const { doc: planDoc, error: planDocError } = useMemo(() => {
    return safeParsePlanJson(plan?.planJson ?? null);
  }, [plan?.planJson]);

  useEffect(() => {
    // Default expand first 2 days
    if (!planDoc?.plan) return;
    const init: Record<string, boolean> = {};
    planDoc.plan.forEach((d, idx) => (init[d.date] = idx < 2));
    setExpandedDays(init);
  }, [planDoc?.plan]);

  const handlePrint = () => {
    window.print();
  };
  
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

        <section className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Shopping List</h2>

            <div className="flex items-center gap-2">
              <button
                onClick={copyShoppingList}
                disabled={!shopping || shopping.items.length === 0}
                className="px-3 py-2 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Copy
              </button>

              <button
                onClick={handlePrint}
                className="px-3 py-2 text-sm rounded-md border bg-white hover:bg-gray-50"
              >
                Print
              </button>
            </div>
          </div>

          {shoppingLoading && <p className="text-sm text-gray-500">Loading shopping list...</p>}
          {shoppingError && <p className="text-sm text-red-600">{shoppingError}</p>}

          {shopping && (
            <>
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{shopping.items.length} unique items</span>
                <span className="font-medium text-gray-900">
                  Est. total: ${shopping.estimatedTotal.toFixed(2)}
                </span>
              </div>

              <div className="divide-y">
                {shopping.items.map((it) => (
                  <div key={it.id} className="py-3 flex items-center gap-3">
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.imageUrl}
                        alt={it.name}
                        className="h-12 w-12 rounded-md object-cover border"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-md border bg-gray-50" />
                    )}

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          {it.qty}x
                        </span>
                        <p className="text-sm font-medium text-gray-900">{it.name}</p>
                      </div>

                      <p className="text-xs text-gray-500">
                        {it.unitSize ?? ""}
                      </p>
                    </div>

                    <div className="text-right text-sm text-gray-700">
                      {it.price != null ? <div>${it.price.toFixed(2)}</div> : <div className="text-gray-400">—</div>}
                      {it.lineTotal != null ? (
                        <div className="text-xs text-gray-500">${it.lineTotal.toFixed(2)}</div>
                      ) : (
                        <div className="text-xs text-gray-400"> </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Nutrition Metrics Summary */}
              {(shopping.caloriesPerDay != null || 
                shopping.fatPerDay != null || 
                shopping.proteinPerDay != null || 
                shopping.carbohydratesPerDay != null ||
                shopping.sodiumPerDay != null ||
                shopping.fiberPerDay != null ||
                shopping.sugarPerDay != null) && (
                <div className="mt-6 pt-6 border-t">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4">Daily Nutrition Summary</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {shopping.caloriesPerDay != null && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-600">Calories</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {shopping.caloriesPerDay.toFixed(0)}
                        </div>
                        <div className="text-xs text-gray-500">per day</div>
                      </div>
                    )}
                    {shopping.proteinPerDay != null && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-600">Protein</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {shopping.proteinPerDay.toFixed(1)}g
                        </div>
                        <div className="text-xs text-gray-500">per day</div>
                      </div>
                    )}
                    {shopping.fatPerDay != null && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-600">Fat</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {shopping.fatPerDay.toFixed(1)}g
                        </div>
                        <div className="text-xs text-gray-500">per day</div>
                      </div>
                    )}
                    {shopping.carbohydratesPerDay != null && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-600">Carbs</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {shopping.carbohydratesPerDay.toFixed(1)}g
                        </div>
                        <div className="text-xs text-gray-500">per day</div>
                      </div>
                    )}
                    {shopping.fiberPerDay != null && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-600">Fiber</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {shopping.fiberPerDay.toFixed(1)}g
                        </div>
                        <div className="text-xs text-gray-500">per day</div>
                      </div>
                    )}
                    {shopping.sugarPerDay != null && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-600">Sugar</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {shopping.sugarPerDay.toFixed(1)}g
                        </div>
                        <div className="text-xs text-gray-500">per day</div>
                      </div>
                    )}
                    {shopping.sodiumPerDay != null && (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-600">Sodium</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {shopping.sodiumPerDay.toFixed(0)}mg
                        </div>
                        <div className="text-xs text-gray-500">per day</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Meal Plan</h2>
              <p className="text-sm text-gray-600 mt-1">
                Click a day to expand meals. (JSON view removed from UI.)
              </p>
            </div>

            {planDoc?.plan?.length ? (
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-2 text-sm rounded-md border bg-white hover:bg-gray-50"
                  onClick={() => {
                    const all: Record<string, boolean> = {};
                    planDoc.plan.forEach((d) => (all[d.date] = true));
                    setExpandedDays(all);
                  }}
                >
                  Expand all
                </button>
                <button
                  className="px-3 py-2 text-sm rounded-md border bg-white hover:bg-gray-50"
                  onClick={() => {
                    const none: Record<string, boolean> = {};
                    planDoc.plan.forEach((d) => (none[d.date] = false));
                    setExpandedDays(none);
                  }}
                >
                  Collapse all
                </button>
              </div>
            ) : null}
          </div>

          {planDocError && (
            <div className="rounded-md border bg-red-50 p-3 text-sm text-red-700">
              {planDocError}
            </div>
          )}

          {!planDoc?.plan?.length ? (
            <div className="rounded-md border bg-gray-50 p-4 text-sm text-gray-700">
              No plan data available.
            </div>
          ) : (
            <div className="space-y-3">
              {planDoc.plan.map((day) => {
                const isOpen = !!expandedDays[day.date];

                // Group meals in a stable order: Breakfast, Lunch, Dinner, then anything else
                const meals = [...(day.meals ?? [])].map((m) => ({
                  ...m,
                  name: normalizeMealName(m.name),
                }));
                const mealOrder = ["Breakfast", "Lunch", "Dinner"];
                meals.sort((a, b) => {
                  const ai = mealOrder.indexOf(a.name);
                  const bi = mealOrder.indexOf(b.name);
                  if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
                  if (ai === -1) return 1;
                  if (bi === -1) return -1;
                  return ai - bi;
                });

                return (
                  <div key={day.date} className="rounded-xl border overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 transition"
                      onClick={() =>
                        setExpandedDays((prev) => ({ ...prev, [day.date]: !prev[day.date] }))
                      }
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-semibold text-gray-900">
                          {formatDayLabel(day.date)}
                        </div>
                        <div className="text-xs text-gray-500">{day.date}</div>
                      </div>
                      <div className="text-sm text-gray-600">{isOpen ? "▾" : "▸"}</div>
                    </button>

                    {isOpen && (
                      <div className="bg-gray-50 px-4 py-4 space-y-4">
                        {meals.length === 0 ? (
                          <div className="text-sm text-gray-500 italic">
                            No meals planned for this day.
                          </div>
                        ) : (
                          meals.map((meal, idx) => (
                            <div key={`${day.date}-${meal.name}-${idx}`} className="space-y-2">
                              <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-gray-900">{meal.name}</h3>
                                <span className="text-xs text-gray-500">
                                  {meal.items?.length ?? 0} items
                                </span>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                {(meal.items ?? []).map((it) => {
                                  const s = findShoppingItem(it.id);
                                  const price = s?.price;

                                  return (
                                    <div
                                      key={it.id}
                                      className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-sm"
                                      title={s?.unitSize ? `${s.unitSize}` : undefined}
                                    >
                                      <span className="font-medium text-gray-900">{it.name}</span>
                                      {price != null && (
                                        <span className="text-xs text-gray-500">${price.toFixed(2)}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
