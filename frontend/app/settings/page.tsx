"use client";

import { useAuthStore } from "@/lib/authStore";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);

  const [prefs, setPrefs] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Later this will call: GET /api/preferences/me
    // For Week 1, just simulate empty prefs
    setPrefs(null);
    setLoading(false);
  }, []);

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
      <div className="max-w-4xl mx-auto py-10 px-4 space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          Settings
        </h1>

        {/* User Info */}
        <section className="bg-white rounded-xl shadow-sm border p-6 space-y-1">
          <h2 className="text-lg font-medium text-gray-800">Account</h2>
          <p className="text-sm text-gray-600">Manage your profile</p>

          <div className="mt-4 space-y-1 text-sm text-gray-700">
            <p><span className="font-medium">Name:</span> {user?.name || "N/A"}</p>
            <p><span className="font-medium">Email:</span> {user?.email}</p>
            <p><span className="font-medium">Provider:</span> {user?.provider || "google"}</p>
          </div>
        </section>

        {/* Preferences Placeholder */}
        <section className="bg-white rounded-xl shadow-sm border p-6 space-y-3">
          <h2 className="text-lg font-medium text-gray-800">
            Preferences
          </h2>

          <p className="text-sm text-gray-600">
            You can set dietary restrictions, disliked ingredients, and calorie goals here.
          </p>

          {loading ? (
            <p className="text-sm text-gray-500">Loading preferences…</p>
          ) : prefs ? (
            <div className="text-sm text-gray-700 space-y-2">
              <p><span className="font-medium">Dietary Restrictions:</span> {prefs.dietaryRestrictions}</p>
              <p><span className="font-medium">Disliked Ingredients:</span> {prefs.dislikedIngredients}</p>
              <p><span className="font-medium">Target Calories:</span> {prefs.targetCaloriesPerDay}</p>
            </div>
          ) : (
            <div className="rounded-md bg-blue-50 border border-blue-200 text-blue-700 p-3 text-sm">
              No preferences set yet.  
              <br />
              Week 2 will let you configure:
              <ul className="list-disc pl-6 mt-2 space-y-1">
                <li>Vegetarian / vegan / halal / no pork</li>
                <li>Allergy settings</li>
                <li>Calorie goals</li>
                <li>Ingredient dislikes</li>
              </ul>
            </div>
          )}
        </section>

        {/* Coming Soon */}
        <section className="bg-white rounded-xl shadow-sm border p-6 space-y-2">
          <h2 className="text-lg font-medium text-gray-800">Coming Soon</h2>
          <p className="text-sm text-gray-600">
            This page will allow you to fully personalize your AI meal recommendations.
          </p>
        </section>
      </div>
    </main>
  );
}
