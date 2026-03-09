"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import { createPortalSession } from "@/lib/api";
import { navigateTo } from "@/lib/navigate";
import type { SubscriptionStatus } from "@/lib/api";

interface NavbarProps {
  userName?: string;
  onLogout: () => void;
  loggingOut: boolean;
  /** Current subscription tier — "FREE" | "PRO" | undefined (not yet loaded) */
  subscriptionTier?: "FREE" | "PRO";
  /** Full subscription status object (optional, for future use) */
  subscriptionStatus?: SubscriptionStatus | null;
}

const baseNavLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/settings", label: "Settings" },
];

export default function Navbar({
  userName,
  onLogout,
  loggingOut,
  subscriptionTier,
}: NavbarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const isPro = subscriptionTier === "PRO";

  const handleBillingClick = async () => {
    setPortalLoading(true);
    try {
      const { url } = await createPortalSession();
      navigateTo(url);
    } catch (err) {
      console.error("Failed to open billing portal:", err);
      setPortalLoading(false);
    }
  };

  // Build nav links — add Pricing for FREE/undefined, no Pricing for PRO
  const navLinks = [
    ...baseNavLinks,
    ...(!isPro ? [{ href: "/pricing", label: "Pricing" }] : []),
  ];

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <Image src="/icon.png" alt="Whole Haul" width={32} height={32} className="rounded-lg" />
          <Image
            src="/whole_haul.png"
            alt="Whole Haul"
            width={110}
            height={24}
            className="object-contain hidden sm:block"
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition",
                pathname === link.href
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* PRO badge */}
          {isPro && (
            <Badge variant="success" className="hidden md:inline-flex">
              PRO
            </Badge>
          )}

          {userName && (
            <span className="hidden md:block text-sm text-gray-500 max-w-[160px] truncate">
              {userName}
            </span>
          )}

          {/* Billing button for PRO users */}
          {isPro && (
            <button
              onClick={handleBillingClick}
              disabled={portalLoading}
              aria-label="Manage billing"
              className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
            >
              {portalLoading ? "Loading…" : "Billing"}
            </button>
          )}

          <button
            onClick={onLogout}
            disabled={loggingOut}
            className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
          >
            {loggingOut ? "Logging out…" : "Log out"}
          </button>

          {/* Mobile hamburger */}
          <button
            className="sm:hidden p-1.5 rounded-md text-gray-600 hover:bg-gray-100 transition"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <XMarkIcon className="h-5 w-5" /> : <Bars3Icon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="sm:hidden border-t border-gray-100 bg-white px-4 py-3 space-y-1 animate-fade-in">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={cn(
                "block px-3 py-2 rounded-md text-sm font-medium transition",
                pathname === link.href
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-700 hover:bg-gray-100"
              )}
            >
              {link.label}
            </Link>
          ))}
          {isPro && (
            <button
              onClick={handleBillingClick}
              disabled={portalLoading}
              className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition"
            >
              {portalLoading ? "Loading…" : "Billing"}
            </button>
          )}
          <button
            onClick={onLogout}
            disabled={loggingOut}
            className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
          >
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      )}
    </header>
  );
}
