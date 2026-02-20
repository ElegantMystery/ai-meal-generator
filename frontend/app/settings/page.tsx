"use client";

import { useAuthStore } from "@/lib/authStore";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AllergyTagInput from "@/components/AllergyTagInput";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

type PreferencesDto = {
  dietaryRestrictions: string | null;
  allergies: string | null;
  targetCaloriesPerDay: number | null;
};

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dietaryStyle, setDietaryStyle] = useState<string>("");
  const [allergies, setAllergies] = useState<string[]>([]);
  const [targetCaloriesPerDay, setTargetCaloriesPerDay] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get<PreferencesDto | null>("/api/preferences/me");
        if (cancelled) return;
        const prefs = res.data;
        setDietaryStyle(prefs?.dietaryRestrictions ?? "");
        setAllergies(
          prefs?.allergies
            ? prefs.allergies
                .split(";")
                .map((a) => a.trim())
                .filter(Boolean)
            : [],
        );
        setTargetCaloriesPerDay(
          prefs?.targetCaloriesPerDay != null
            ? String(prefs.targetCaloriesPerDay)
            : "",
        );
      } catch (err: unknown) {
        if (cancelled) return;
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 401) {
          router.push("/login");
          return;
        }
        console.error("Failed to load preferences:", err);
        toast("Failed to load preferences.", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [router, toast]);

  const onSave = async () => {
    setSaving(true);

    const allergiesString = allergies.length > 0 ? allergies.join(";") : null;
    const payload: PreferencesDto = {
      dietaryRestrictions: dietaryStyle.trim() || null,
      allergies: allergiesString,
      targetCaloriesPerDay: targetCaloriesPerDay.trim()
        ? Number(targetCaloriesPerDay.trim())
        : null,
    };

    if (
      payload.targetCaloriesPerDay != null &&
      Number.isNaN(payload.targetCaloriesPerDay)
    ) {
      setSaving(false);
      toast("Target calories must be a number.", "error");
      return;
    }

    try {
      await api.put("/api/preferences/me", payload);
      toast("Preferences saved!", "success");
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (e?.response?.status === 401) {
        router.push("/login");
        return;
      }
      console.error("Failed to save preferences:", err);
      toast("Failed to save preferences.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Personalize your meal recommendations.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={onSave}
          disabled={loading || saving}
          loading={saving}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* Account card */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your signed-in details.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-1 text-sm text-gray-700">
            <div className="flex gap-2">
              <dt className="font-medium w-20 shrink-0">Name</dt>
              <dd className="text-gray-600">{user?.name || "N/A"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium w-20 shrink-0">Email</dt>
              <dd className="text-gray-600">{user?.email || "N/A"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium w-20 shrink-0">Provider</dt>
              <dd className="text-gray-600">{user?.provider || "email"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Preferences card */}
      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>
            Set your dietary style, allergies, and calorie target.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <SkeletonText lines={4} />
          ) : (
            <div className="space-y-5">
              <Select
                id="dietaryStyle"
                label="Dietary Style"
                value={dietaryStyle}
                onChange={(e) => setDietaryStyle(e.target.value)}
              >
                <option value="">None / No restrictions</option>
                <option value="vegetarian">Vegetarian</option>
                <option value="vegan">Vegan</option>
                <option value="keto">Keto / Ketogenic</option>
                <option value="low-carb">Low-carb</option>
                <option value="high-protein">High-protein</option>
                <option value="gluten-free">Gluten-free</option>
                <option value="dairy-free">Dairy-free</option>
              </Select>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Allergies
                </label>
                <AllergyTagInput
                  value={allergies}
                  onChange={setAllergies}
                  placeholder="e.g. gluten, peanut, banana"
                />
              </div>

              <div>
                <Input
                  id="calories"
                  label="Target Calories Per Day"
                  value={targetCaloriesPerDay}
                  onChange={(e) => setTargetCaloriesPerDay(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 2000"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Optional — leave blank if you don&apos;t have a target yet.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
