"use client";

import { useAuthStore } from "@/lib/authStore";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    // If user is already in store, we're good
    if (user) {
      setLoading(false);
      return;
    }

    // If we're logging out, don't fetch
    if (loggingOut) {
      return;
    }

    // Otherwise, fetch user from backend
    const fetchUser = async () => {
      try {
        const res = await api.get("/api/auth/me");
        setUser(res.data);
        setLoading(false);
      } catch (err: any) {
        // Handle 401 (Unauthorized) gracefully - user is not authenticated
        if (err?.response?.status === 401) {
          // User is not authenticated, redirect to login silently
          setLoading(false);
          router.push("/login");
          return;
        }
        // For other errors, log and redirect
        console.error("Failed to fetch user:", err);
        setLoading(false);
        router.push("/login");
      }
    };

    fetchUser();
  }, [user, setUser, router, loggingOut]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      // Call backend logout endpoint
      await api.post("/api/auth/logout");
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      // Clear user from store and redirect immediately
      setUser(null);
      // Use replace to prevent back button from going to dashboard
      router.replace("/");
      // Reset loggingOut after a brief delay to allow redirect to complete
      setTimeout(() => setLoggingOut(false), 100);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect in useEffect
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-end items-center h-16">
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loggingOut ? "Logging out..." : "Log out"}
            </button>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
