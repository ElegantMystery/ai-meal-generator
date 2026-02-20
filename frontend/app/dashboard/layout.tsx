"use client";

import { useAuthStore } from "@/lib/authStore";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import OnboardingModal from "@/components/OnboardingModal";
import Navbar from "@/components/Navbar";
import { Skeleton } from "@/components/ui/Skeleton";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (user) {
      setLoading(false);
      if (user.onboardingCompleted === false) setShowOnboarding(true);
      return;
    }

    if (loggingOut) return;

    const fetchUser = async () => {
      try {
        const res = await api.get("/api/auth/me");
        setUser(res.data);
        setLoading(false);
        if (res.data.onboardingCompleted === false) setShowOnboarding(true);
      } catch (err: unknown) {
        const e = err as { response?: { status?: number } };
        if (e?.response?.status === 401) {
          setLoading(false);
          router.push("/login");
          return;
        }
        console.error("Failed to fetch user:", err);
        setLoading(false);
        router.push("/login");
      }
    };

    fetchUser();
  }, [user, setUser, router, loggingOut]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    if (user) setUser({ ...user, onboardingCompleted: true });
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await api.post("/api/auth/logout");
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      setUser(null);
      router.replace("/");
      setTimeout(() => setLoggingOut(false), 100);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-50">
        <div className="bg-white border-b border-gray-200 h-16 flex items-center px-6 gap-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-5 w-28" />
          <div className="ml-auto flex gap-3">
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="h-7 w-20 rounded-md" />
          </div>
        </div>
        <div className="max-w-6xl mx-auto py-10 px-4 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="h-40 lg:col-span-2 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface-50">
      <OnboardingModal isOpen={showOnboarding} onComplete={handleOnboardingComplete} />
      <Navbar
        userName={user.name || user.email}
        onLogout={handleLogout}
        loggingOut={loggingOut}
      />
      {children}
    </div>
  );
}
