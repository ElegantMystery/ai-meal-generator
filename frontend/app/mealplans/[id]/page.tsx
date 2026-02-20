"use client";

import { api } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  PrinterIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SkeletonCard, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/Modal";
import { formatDateRange, formatCreatedAt } from "@/lib/formatters";

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

function safeParsePlanJson(planJson: string | null): {
  doc: PlanDoc | null;
  error?: string;
} {
  if (!planJson) return { doc: null };
  try {
    const parsed = JSON.parse(planJson);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.plan))
      return { doc: null, error: "Plan JSON has unexpected shape." };
    return { doc: parsed as PlanDoc };
  } catch {
    return { doc: null, error: "Plan JSON is not valid JSON." };
  }
}

function formatDayLabel(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function normalizeMealName(name: string) {
  const n = (name || "").toLowerCase();
  if (n.includes("break")) return "Breakfast";
  if (n.includes("lunch")) return "Lunch";
  if (n.includes("dinner")) return "Dinner";
  return name || "Meal";
}

const mealAccent: Record<string, string> = {
  Breakfast: "border-l-amber-400",
  Lunch: "border-l-brand-500",
  Dinner: "border-l-indigo-400",
};

const nutritionStats = [
  { key: "caloriesPerDay", label: "Calories", unit: "", decimals: 0 },
  { key: "proteinPerDay", label: "Protein", unit: "g", decimals: 1 },
  { key: "fatPerDay", label: "Fat", unit: "g", decimals: 1 },
  { key: "carbohydratesPerDay", label: "Carbs", unit: "g", decimals: 1 },
  { key: "fiberPerDay", label: "Fiber", unit: "g", decimals: 1 },
  { key: "sugarPerDay", label: "Sugar", unit: "g", decimals: 1 },
  { key: "sodiumPerDay", label: "Sodium", unit: "mg", decimals: 0 },
] as const;

export default function MealPlanDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shopping, setShopping] = useState<ShoppingListResponse | null>(null);
  const [shoppingLoading, setShoppingLoading] = useState(false);
  const [shoppingError, setShoppingError] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});

  const id = params?.id;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.get<MealPlan>(`/api/mealplans/${id}`);
        if (cancelled) return;
        setPlan(res.data);
      } catch (err: unknown) {
        if (cancelled) return;
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 401) {
          router.push("/login");
          return;
        }
        if (e?.response?.status === 404) {
          setError("Meal plan not found.");
          return;
        }
        console.error(err);
        setError("Failed to load meal plan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const fetchShopping = async () => {
      setShoppingLoading(true);
      try {
        const res = await api.get<ShoppingListResponse>(
          `/api/mealplans/${id}/shopping-list`,
        );
        if (cancelled) return;
        setShopping(res.data);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setShoppingError("Failed to load shopping list.");
      } finally {
        if (!cancelled) setShoppingLoading(false);
      }
    };
    fetchShopping();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const findShoppingItem = (itemId: number) =>
    shopping?.items?.find((x) => x.id === itemId) ?? null;

  const copyShoppingList = async () => {
    if (!shopping) return;
    const text = shopping.items
      .map((it) => {
        const priceStr = it.price != null ? ` ($${it.price.toFixed(2)})` : "";
        const unitStr = it.unitSize ? ` - ${it.unitSize}` : "";
        return `${it.qty}x ${it.name}${unitStr}${priceStr}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Shopping list copied to clipboard!", "success");
    } catch {
      toast("Could not copy to clipboard. Please copy manually.", "error");
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await api.delete(`/api/mealplans/${id}`);
      router.push("/dashboard");
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (e?.response?.status === 401) {
        router.push("/login");
        return;
      }
      console.error(err);
      toast("Failed to delete meal plan.", "error");
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  };

  const { doc: planDoc, error: planDocError } = useMemo(
    () => safeParsePlanJson(plan?.planJson ?? null),
    [plan?.planJson],
  );

  useEffect(() => {
    if (!planDoc?.plan) return;
    const init: Record<string, boolean> = {};
    planDoc.plan.forEach((d, i) => (init[d.date] = i < 2));
    setExpandedDays(init);
  }, [planDoc?.plan]);

  const checkedCount = Object.values(checkedItems).filter(Boolean).length;

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto py-10 px-4 space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-4xl mx-auto py-10 px-4 space-y-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Back to Dashboard
        </Link>
        <Card>
          <CardContent>
            <p className="text-sm text-red-600 pt-6">{error}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!plan) return null;

  return (
    <main className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Delete confirmation modal */}
      <Modal
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title="Delete meal plan?"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">This action cannot be undone.</p>
          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              onClick={() => setConfirmDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={deleting}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition"
      >
        <ArrowLeftIcon className="h-4 w-4" /> Back to Dashboard
      </Link>

      {/* Plan header */}
      <Card>
        <CardContent className="pt-6">
          <h1 className="text-2xl font-bold text-gray-900">{plan.title}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {formatDateRange(plan.startDate, plan.endDate)}
            {plan.createdAt
              ? ` · Created ${formatCreatedAt(plan.createdAt)}`
              : ""}
          </p>
        </CardContent>
      </Card>

      {/* Shopping list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Shopping List</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={copyShoppingList}
                disabled={!shopping || shopping.items.length === 0}
              >
                <ClipboardDocumentIcon className="h-4 w-4" />
                Copy
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.print()}
              >
                <PrinterIcon className="h-4 w-4" />
                Print
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {shoppingLoading && <SkeletonText lines={4} />}
          {shoppingError && (
            <p className="text-sm text-red-600">{shoppingError}</p>
          )}

          {shopping && (
            <>
              {/* Progress indicator */}
              <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
                <span>
                  {checkedCount > 0
                    ? `${checkedCount} / ${shopping.items.length} items checked`
                    : `${shopping.items.length} items`}
                </span>
                <span className="font-semibold text-gray-900">
                  Est. ${shopping.estimatedTotal.toFixed(2)}
                </span>
              </div>

              {checkedCount > 0 && (
                <div className="w-full bg-gray-100 rounded-full h-1.5 mb-4">
                  <div
                    className="bg-brand-500 h-1.5 rounded-full transition-all"
                    style={{
                      width: `${(checkedCount / shopping.items.length) * 100}%`,
                    }}
                  />
                </div>
              )}

              <div className="divide-y">
                {shopping.items.map((it) => (
                  <label
                    key={it.id}
                    htmlFor={`item-${it.id}`}
                    className="py-3 flex items-center gap-3 cursor-pointer group"
                  >
                    {/* Visually-hidden real checkbox for keyboard/screen-reader access */}
                    <input
                      id={`item-${it.id}`}
                      type="checkbox"
                      className="sr-only"
                      checked={!!checkedItems[it.id]}
                      onChange={() =>
                        setCheckedItems((p) => ({ ...p, [it.id]: !p[it.id] }))
                      }
                    />
                    {/* Visual checkbox */}
                    <div
                      aria-hidden="true"
                      className={`h-5 w-5 rounded border flex items-center justify-center shrink-0 transition ${checkedItems[it.id] ? "bg-brand-600 border-brand-600" : "border-gray-300 group-hover:border-brand-400"}`}
                    >
                      {checkedItems[it.id] && (
                        <svg
                          className="h-3 w-3 text-white"
                          viewBox="0 0 12 12"
                          fill="none"
                        >
                          <path
                            d="M2 6l3 3 5-5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>

                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.imageUrl}
                        alt={it.name}
                        className="h-10 w-10 rounded-md object-cover border shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-md border bg-gray-50 shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="default">{it.qty}x</Badge>
                        <p
                          className={`text-sm font-medium truncate ${checkedItems[it.id] ? "line-through text-gray-400" : "text-gray-900"}`}
                        >
                          {it.name}
                        </p>
                      </div>
                      {it.unitSize && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {it.unitSize}
                        </p>
                      )}
                    </div>

                    <div className="text-right text-sm shrink-0">
                      {it.price != null ? (
                        <div className="font-medium text-gray-700">
                          ${it.price.toFixed(2)}
                        </div>
                      ) : (
                        <div className="text-gray-300">—</div>
                      )}
                      {it.lineTotal != null && (
                        <div className="text-xs text-gray-400">
                          ${it.lineTotal.toFixed(2)} total
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>

              {/* Nutrition */}
              {nutritionStats.some((s) => shopping[s.key] != null) && (
                <div className="mt-6 pt-6 border-t">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Daily Nutrition
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {nutritionStats.map(({ key, label, unit, decimals }) => {
                      const val = shopping[key];
                      if (val == null) return null;
                      return (
                        <div
                          key={key}
                          className="rounded-lg border border-gray-100 bg-surface-50 p-3"
                        >
                          <p className="text-xs text-gray-500">{label}</p>
                          <p className="text-lg font-bold text-gray-900 mt-0.5">
                            {val.toFixed(decimals)}
                            <span className="text-xs font-normal text-gray-400 ml-0.5">
                              {unit}
                            </span>
                          </p>
                          <p className="text-xs text-gray-400">per day</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Meal plan days */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Meal Plan</CardTitle>
            {planDoc?.plan?.length ? (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const all: Record<string, boolean> = {};
                    planDoc.plan.forEach((d) => (all[d.date] = true));
                    setExpandedDays(all);
                  }}
                >
                  Expand all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const none: Record<string, boolean> = {};
                    planDoc.plan.forEach((d) => (none[d.date] = false));
                    setExpandedDays(none);
                  }}
                >
                  Collapse all
                </Button>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {planDocError && (
            <p className="text-sm text-red-600 mb-4">{planDocError}</p>
          )}

          {!planDoc?.plan?.length ? (
            <p className="text-sm text-gray-500">No plan data available.</p>
          ) : (
            <div className="space-y-2">
              {planDoc.plan.map((day) => {
                const isOpen = !!expandedDays[day.date];
                const meals = [...(day.meals ?? [])]
                  .map((m) => ({ ...m, name: normalizeMealName(m.name) }))
                  .sort((a, b) => {
                    const order = ["Breakfast", "Lunch", "Dinner"];
                    const ai = order.indexOf(a.name),
                      bi = order.indexOf(b.name);
                    if (ai === -1 && bi === -1)
                      return a.name.localeCompare(b.name);
                    if (ai === -1) return 1;
                    if (bi === -1) return -1;
                    return ai - bi;
                  });

                return (
                  <div
                    key={day.date}
                    className="rounded-xl border overflow-hidden"
                  >
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-surface-50 transition text-left"
                      aria-expanded={isOpen}
                      aria-controls={`day-panel-${day.date}`}
                      onClick={() =>
                        setExpandedDays((p) => ({
                          ...p,
                          [day.date]: !p[day.date],
                        }))
                      }
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-gray-900">
                          {formatDayLabel(day.date)}
                        </span>
                        <span className="text-xs text-gray-400">
                          {day.date}
                        </span>
                        <Badge variant="default">{meals.length} meals</Badge>
                      </div>
                      {isOpen ? (
                        <ChevronDownIcon className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                      )}
                    </button>

                    {isOpen && (
                      <div
                        id={`day-panel-${day.date}`}
                        className="bg-surface-50 px-4 py-4 space-y-4 border-t"
                      >
                        {meals.length === 0 ? (
                          <p className="text-sm text-gray-400 italic">
                            No meals planned.
                          </p>
                        ) : (
                          meals.map((meal, idx) => (
                            <div
                              key={`${day.date}-${meal.name}-${idx}`}
                              className={`border-l-4 pl-3 ${mealAccent[meal.name] ?? "border-l-gray-300"}`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-semibold text-gray-900">
                                  {meal.name}
                                </h3>
                                <span className="text-xs text-gray-400">
                                  {meal.items?.length ?? 0} items
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {(meal.items ?? []).map((it) => {
                                  const s = findShoppingItem(it.id);
                                  return (
                                    <div
                                      key={it.id}
                                      className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-sm"
                                      title={s?.unitSize ?? undefined}
                                    >
                                      <span className="font-medium text-gray-900">
                                        {it.name}
                                      </span>
                                      {s?.price != null && (
                                        <span className="text-xs text-gray-400">
                                          ${s.price.toFixed(2)}
                                        </span>
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
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Delete this meal plan
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                This action cannot be undone.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deleting}
            >
              <TrashIcon className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
