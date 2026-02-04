"use client";

import { useState } from "react";
import Modal from "./Modal";
import AllergyTagInput from "./AllergyTagInput";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

export default function OnboardingModal({ isOpen, onComplete }: OnboardingModalProps) {
  const incrementPreferencesVersion = useAuthStore((s) => s.incrementPreferencesVersion);
  const [dietaryStyle, setDietaryStyle] = useState<string>("");
  const [allergies, setAllergies] = useState<string[]>([]);
  const [targetCaloriesPerDay, setTargetCaloriesPerDay] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const allergiesString = allergies.length > 0 ? allergies.join(";") : null;

    const payload = {
      dietaryRestrictions: dietaryStyle.trim() || null,
      allergies: allergiesString,
      targetCaloriesPerDay: targetCaloriesPerDay.trim()
        ? Number(targetCaloriesPerDay.trim())
        : null,
    };

    if (payload.targetCaloriesPerDay != null && Number.isNaN(payload.targetCaloriesPerDay)) {
      setSaving(false);
      setError("Target calories must be a number.");
      return;
    }

    try {
      await api.put("/api/preferences/me", payload);
      await api.post("/api/auth/complete-onboarding");
      incrementPreferencesVersion();
      onComplete();
    } catch (err) {
      console.error("Failed to save preferences:", err);
      setError("Failed to save preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    setError(null);

    try {
      await api.post("/api/auth/complete-onboarding");
      onComplete();
    } catch (err) {
      console.error("Failed to skip onboarding:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} preventClose title="Welcome! Let's set up your profile">
      <div className="space-y-6">
        <p className="text-sm text-gray-600">
          Help us personalize your meal plans by telling us about your dietary preferences.
          You can always update these later in Settings.
        </p>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Dietary Style
          </label>
          <select
            value={dietaryStyle}
            onChange={(e) => setDietaryStyle(e.target.value)}
            disabled={saving}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            <option value="">None / No restrictions</option>
            <option value="vegetarian">Vegetarian</option>
            <option value="vegan">Vegan</option>
            <option value="keto">Keto / Ketogenic</option>
            <option value="low-carb">Low-carb</option>
            <option value="high-protein">High-protein</option>
            <option value="gluten-free">Gluten-free</option>
            <option value="dairy-free">Dairy-free</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Allergies
          </label>
          <AllergyTagInput
            value={allergies}
            onChange={setAllergies}
            placeholder="e.g. gluten, peanut, banana"
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
            disabled={saving}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-gray-500">
            Optional - leave blank if you don't have a target yet.
          </p>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={handleSkip}
            disabled={saving}
            className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {saving ? "Saving..." : "Save & Continue"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
