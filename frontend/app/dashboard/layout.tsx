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
    if (user) {
      setLoading(false);
      return;
    }

    if (loggingOut) {
      return;
    }

    const fetchUser = async () => {
      try {
        // Your backend exposes /api/auth/me – keeping that
        const res = await api.get("/api/auth/me");
        setUser(res.data);
        setLoading(false);
      } catch (err: any) {
        if (err?.response?.status === 401) {
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
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null; // redirect handled in useEffect
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Left - User info */}
            <div className="flex flex-col">
              <span className="text-sm text-gray-500">Signed in as</span>
              <span className="text-sm font-medium text-gray-900">
                {user?.name || user?.email}
              </span>
            </div>
  
            {/* Right - Navigation + Logout */}
            <div className="flex items-center gap-4">
              {/* Settings link */}
              <a
                href="/settings"
                className="text-sm font-medium text-gray-700 hover:text-gray-900 transition"
              >
                Settings
              </a>
  
              {/* Logout button */}
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loggingOut ? "Logging out..." : "Log out"}
              </button>
            </div>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}