"use client";

import { useAuthStore } from "@/lib/authStore";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto py-10 px-4 space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">
          Dashboard
        </h1>

        <div className="bg-white rounded-xl shadow-sm border p-6 space-y-2">
          <p className="text-gray-700">
            Welcome,{" "}
            <span className="font-semibold">
              {user?.name || user?.email || "friend"}
            </span>
            !
          </p>
          <p className="text-sm text-gray-500">
            (This is a placeholder dashboard; soon this will show Costco / Trader Joe’s items and meal plans.)
          </p>
        </div>
      </div>
    </main>
  );
}
