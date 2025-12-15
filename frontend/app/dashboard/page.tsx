"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/authStore";
import { api } from "@/lib/api";

interface Item {
  id: number;
  store: string;
  name: string;
  price?: number;
  weight?: string;
  categories?: string;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  const [costcoItems, setCostcoItems] = useState<Item[]>([]);
  const [traderItems, setTraderItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchItems = async () => {
      try {
        // Using the generic /api/items?store=... endpoint
        const [costcoRes, traderRes] = await Promise.all([
          api.get<Item[]>("/api/items", { params: { store: "COSTCO" } }),
          api.get<Item[]>("/api/items", { params: { store: "TRADER_JOES" } }),
        ]);

        setCostcoItems(costcoRes.data || []);
        setTraderItems(traderRes.data || []);
      } catch (err) {
        console.error("Failed to fetch items:", err);
        setError("Failed to load items from backend.");
      } finally {
        setLoadingItems(false);
      }
    };

    fetchItems();
  }, []);

  const totalItems = costcoItems.length + traderItems.length;

  const firstCostco = costcoItems.slice(0, 5);
  const firstTrader = traderItems.slice(0, 5);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-10 px-4 space-y-6">
        {/* Title + Welcome */}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-gray-700">
            Welcome,{" "}
            <span className="font-semibold">
              {user?.name || user?.email || "friend"}
            </span>
            ! Here’s a quick view of your Costco / Trader Joe’s data.
          </p>
        </div>

        {/* Summary cards */}
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Total Items
              </p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {loadingItems ? "…" : totalItems}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Combined Costco + Trader Joe&apos;s
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Costco Items
              </p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {loadingItems ? "…" : costcoItems.length}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Seed data from your backend
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Trader Joe&apos;s Items
              </p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {loadingItems ? "…" : traderItems.length}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Seed data from your backend
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Meal Plans
              </p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">0</p>
              <p className="mt-1 text-xs text-gray-500">
                Coming soon – AI meal planning
              </p>
            </div>
          </div>
        </section>

        {/* Error message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
            {error}
          </div>
        )}

        {/* Items preview */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Costco Items (sample)
              </h2>
              <span className="text-xs text-gray-500">
                Showing {firstCostco.length} of {costcoItems.length}
              </span>
            </div>

            {loadingItems ? (
              <p className="text-sm text-gray-500">Loading Costco items…</p>
            ) : firstCostco.length === 0 ? (
              <p className="text-sm text-gray-500">
                No Costco items found yet. Seed some data in the backend.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {firstCostco.map((item) => (
                  <li key={item.id} className="py-2">
                    <p className="text-sm font-medium text-gray-900">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.weight && <span>{item.weight} · </span>}
                      {typeof item.price === "number" && (
                        <span>${item.price.toFixed(2)}</span>
                      )}
                    </p>
                    {item.categories && (
                      <p className="text-xs text-gray-400 mt-1">
                        {item.categories}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Trader Joe&apos;s Items (sample)
              </h2>
              <span className="text-xs text-gray-500">
                Showing {firstTrader.length} of {traderItems.length}
              </span>
            </div>

            {loadingItems ? (
              <p className="text-sm text-gray-500">Loading Trader Joe&apos;s items…</p>
            ) : firstTrader.length === 0 ? (
              <p className="text-sm text-gray-500">
                No Trader Joe&apos;s items found yet. Seed some data in the backend.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {firstTrader.map((item) => (
                  <li key={item.id} className="py-2">
                    <p className="text-sm font-medium text-gray-900">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.weight && <span>{item.weight} · </span>}
                      {typeof item.price === "number" && (
                        <span>${item.price.toFixed(2)}</span>
                      )}
                    </p>
                    {item.categories && (
                      <p className="text-xs text-gray-400 mt-1">
                        {item.categories}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Future sections placeholders */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">
              Your Meal Plans
            </h2>
            <p className="text-sm text-gray-500">
              You don&apos;t have any saved meal plans yet. Soon, AI will
              generate Costco / TJ meal plans here based on your preferences.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">
              Your Preferences
            </h2>
            <p className="text-sm text-gray-500">
              Dietary preferences and nutrition goals (calories, protein, etc.)
              will be configurable here in Week 2.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
