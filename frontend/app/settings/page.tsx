"use client";

import { useAuthStore } from "@/lib/authStore";
import { api } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AllergyTagInput from "@/components/AllergyTagInput";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import {
  ArrowLeftIcon,
  AdjustmentsHorizontalIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";

type PreferencesDto = {
  dietaryRestrictions: string | null;
  allergies: string | null;
  targetCaloriesPerDay: number | null;
};

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const refreshPreferences = useAuthStore((s) => s.incrementPreferencesVersion);
  const router = useRouter();
  const { toast } = useToast();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [retry, setRetry] = useState(0);
  const [accountError, setAccountError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [dietaryStyle, setDietaryStyle] = useState("");
  const [allergies, setAllergies] = useState<string[]>([]);
  const [targetCaloriesPerDay, setTargetCaloriesPerDay] = useState("");

  // A direct visit does not pass through the dashboard's account loader.
  useEffect(() => {
    if (user) return;
    let cancelled = false;
    setAccountError(false);
    api
      .get("/api/auth/me")
      .then((res) => {
        if (!cancelled) setUser(res.data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (
          (error as { response?: { status?: number } })?.response?.status ===
          401
        )
          router.push("/login");
        else setAccountError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, setUser, router, retry]);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    api
      .get<PreferencesDto | null>("/api/preferences/me")
      .then((res) => {
        if (cancelled) return;
        setDietaryStyle(res.data?.dietaryRestrictions ?? "");
        setAllergies(
          res.data?.allergies
            ?.split(";")
            .map((value) => value.trim())
            .filter(Boolean) ?? [],
        );
        setTargetCaloriesPerDay(
          res.data?.targetCaloriesPerDay != null
            ? String(res.data.targetCaloriesPerDay)
            : "",
        );
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadState("error");
        if (
          (error as { response?: { status?: number } })?.response?.status ===
          401
        )
          router.push("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router, retry]);

  const onSave = async () => {
    if (loadState !== "ready" || savingRef.current) return;
    setFeedback(null);
    const payload: PreferencesDto = {
      dietaryRestrictions: dietaryStyle.trim() || null,
      allergies: allergies.length ? allergies.join(";") : null,
      targetCaloriesPerDay: targetCaloriesPerDay.trim()
        ? Number(targetCaloriesPerDay.trim())
        : null,
    };
    if (
      payload.targetCaloriesPerDay != null &&
      !Number.isFinite(payload.targetCaloriesPerDay)
    ) {
      setFeedback({
        kind: "error",
        message: "Target calories must be a number.",
      });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await api.put("/api/preferences/me", payload);
      refreshPreferences();
      setFeedback({
        kind: "success",
        message:
          "Preferences saved. Your next meal plan will use these choices.",
      });
      toast("Preferences saved!", "success");
    } catch (error: unknown) {
      if (
        (error as { response?: { status?: number } })?.response?.status === 401
      )
        router.push("/login");
      setFeedback({
        kind: "error",
        message:
          "Unable to save preferences. Your edits are still here. Please try again.",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface-50">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-brand-600 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600"
        >
          <ArrowLeftIcon aria-hidden="true" className="h-4 w-4" />
          Back to Home
        </Link>
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            Made for you
          </p>
          <h1 className="mt-2 font-brand text-3xl text-brand-900 sm:text-4xl">
            Preferences
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-gray-600">
            A few details help us plan meals around you. Set your food
            preferences for your next haul.
          </p>
        </header>
        <div className="grid items-start gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="border-b border-brand-100 bg-brand-50">
              <UserCircleIcon
                aria-hidden="true"
                className="mb-3 h-7 w-7 text-brand-600"
              />
              <h2 className="font-brand text-xl text-brand-900">
                Your account
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Your signed-in details.
              </p>
            </CardHeader>
            <CardContent className="pt-5">
              {user ? (
                <dl className="space-y-4 text-sm">
                  {[
                    ["Name", user.name || "Not available"],
                    ["Email", user.email || "Not available"],
                    ["Provider", user.provider || "Not available"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="font-medium text-gray-700">{label}</dt>
                      <dd className="mt-1 break-words text-gray-600 [overflow-wrap:anywhere]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-gray-600">
                  {accountError
                    ? "Account details unavailable. Return Home to reload your account."
                    : "Loading account details…"}
                </p>
              )}
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="border-b border-surface-100">
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-brand-50 p-2 text-brand-600">
                  <AdjustmentsHorizontalIcon
                    aria-hidden="true"
                    className="h-6 w-6"
                  />
                </span>
                <h2 className="font-brand text-xl text-brand-900">
                  Your food preferences
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">
                Choose what works for you. You can update these anytime.
              </p>
            </CardHeader>
            <CardContent className="pt-6">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void onSave();
                }}
                className="space-y-6"
              >
                {loadState === "loading" ? (
                  <div role="status">
                    <p className="mb-4 text-sm text-gray-600">
                      Loading preferences…
                    </p>
                    <SkeletonText lines={4} />
                  </div>
                ) : loadState === "error" ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <p role="alert" className="text-sm text-red-700">
                      Unable to load preferences. Your saved choices have not
                      been changed.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3 min-h-11"
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      Try again
                    </Button>
                  </div>
                ) : (
                  <fieldset
                    disabled={saving}
                    className="min-w-0 space-y-6"
                    onChange={() => setFeedback(null)}
                  >
                    <legend className="sr-only">Food preferences</legend>
                    <div>
                      <Select
                        id="dietaryStyle"
                        label="Dietary style"
                        className="min-h-11"
                        value={dietaryStyle}
                        onChange={(event) =>
                          setDietaryStyle(event.target.value)
                        }
                        aria-describedby="diet-help"
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
                      <p
                        id="diet-help"
                        className="mt-2 text-xs leading-relaxed text-gray-500"
                      >
                        The eating style you want your meal plans to follow.
                      </p>
                    </div>
                    <div className="border-t border-surface-100 pt-6">
                      <label
                        htmlFor="allergies"
                        className="mb-1 block text-sm font-medium text-gray-700"
                      >
                        Allergies
                      </label>
                      <AllergyTagInput
                        id="allergies"
                        value={allergies}
                        onChange={(value) => {
                          setAllergies(value);
                          setFeedback(null);
                        }}
                        placeholder="e.g. gluten, peanut, banana"
                      />
                    </div>
                    <div className="border-t border-surface-100 pt-6">
                      <Input
                        id="calories"
                        label="Daily calorie target"
                        className="min-h-11"
                        value={targetCaloriesPerDay}
                        onChange={(event) =>
                          setTargetCaloriesPerDay(event.target.value)
                        }
                        inputMode="numeric"
                        placeholder="e.g. 2000"
                        aria-describedby="calories-help"
                      />
                      <p
                        id="calories-help"
                        className="mt-2 text-xs leading-relaxed text-gray-500"
                      >
                        kcal per person, per day. Optional — leave blank if you
                        don&apos;t have a target yet.
                      </p>
                    </div>
                  </fieldset>
                )}
                <div className="space-y-4 border-t border-surface-200 pt-5">
                  {feedback && (
                    <p
                      role={feedback.kind === "error" ? "alert" : "status"}
                      className={
                        feedback.kind === "error"
                          ? "text-sm text-red-700"
                          : "text-sm text-brand-700"
                      }
                    >
                      {feedback.message}
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="min-h-12 w-full sm:w-auto"
                    disabled={loadState !== "ready" || saving}
                    loading={saving}
                  >
                    {saving ? "Saving…" : "Save preferences"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
