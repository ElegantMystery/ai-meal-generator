"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { api, apiBaseUrl } from "@/lib/api";
import { useAuthStore } from "@/lib/authStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = () => {
    window.location.href = `${apiBaseUrl}/oauth2/authorization/google`;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const res = await api.post("/api/auth/signup", { email, name, password });
      setUser(res.data.user);
      router.push("/dashboard");
    } catch (err: unknown) {
      console.error(err);
      const axiosError = err as { response?: { data?: { code?: string; error?: string } } };
      const errorMessage = axiosError.response?.data?.error || "Signup failed. Please try again.";
      const errorCode = axiosError.response?.data?.code;

      if (errorCode === "EMAIL_EXISTS") {
        setError("An account with this email already exists. Please sign in instead.");
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/">
            <Image src="/icon.png" alt="Whole Haul" width={36} height={36} className="rounded-xl" />
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back
          </Link>
        </div>
      </header>

      {/* Form */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md animate-fade-in">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
            <p className="text-sm text-gray-500 mt-1">Free to start. No credit card required.</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-5">
            {/* Google button */}
            <Button type="button" variant="secondary" size="lg" className="w-full" onClick={handleGoogleSignIn}>
              <GoogleIcon />
              Continue with Google
            </Button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-400">or</span>
              </div>
            </div>

            {/* Email form */}
            <form onSubmit={handleSignup} className="space-y-4">
              <Input
                id="name"
                type="text"
                label="Name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                id="email"
                type="email"
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                id="password"
                type="password"
                label="Password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
              <Input
                id="confirmPassword"
                type="password"
                label="Confirm Password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {error}
                </p>
              )}

              <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
                {loading ? "Creating account…" : "Create account"}
              </Button>
            </form>

            <p className="text-center text-sm text-gray-500">
              Already have an account?{" "}
              <Link href="/login" className="text-brand-600 font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
