"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  AdjustmentsHorizontalIcon,
  ArrowRightStartOnRectangleIcon,
  ChevronDownIcon,
  CreditCardIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { cn } from "@/lib/cn";
import type { SubscriptionStatus } from "@/lib/api";

interface NavbarProps {
  userName?: string;
  onLogout: () => void | Promise<void>;
  loggingOut: boolean;
  subscriptionTier?: "FREE" | "PRO";
  subscriptionStatus?: SubscriptionStatus | null;
}

export default function Navbar({
  userName,
  onLogout,
  loggingOut,
}: NavbarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const submittingRef = useRef(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const name = userName?.trim();
  const parts = name && !name.includes("@") ? name.split(/\s+/) : [];
  const firstName = parts[0] || "Account";
  const initials = parts.length
    ? [parts[0], ...(parts.length > 1 ? [parts[parts.length - 1]] : [])]
        .map((part) => Array.from(part)[0])
        .join("")
        .toLocaleUpperCase()
    : null;
  const pending = loggingOut || submitting;

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !accountRef.current?.contains(event.target)
      )
        setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const signOut = async () => {
    if (loggingOut || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setLogoutError(false);
    try {
      await onLogout();
    } catch {
      setLogoutError(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  const entryStyle =
    "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

  return (
    <header className="sticky top-0 z-40 border-b border-brand-100 bg-white">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/dashboard"
          aria-label="Whole Haul home"
          className="flex min-h-11 shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600"
        >
          <Image
            src="/icon.png"
            alt=""
            width={32}
            height={32}
            className="rounded-lg"
          />
          <Image
            src="/whole_haul.png"
            alt=""
            width={110}
            height={24}
            className="object-contain"
          />
        </Link>
        <div
          ref={accountRef}
          className="relative min-w-0"
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setMenuOpen(false);
          }}
        >
          <button
            ref={triggerRef}
            type="button"
            aria-label="Account menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((open) => !open)}
            className={cn(
              "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border p-1.5 text-brand-800 transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600 sm:pr-3",
              menuOpen
                ? "border-brand-200 bg-brand-50"
                : "border-transparent hover:border-brand-100 hover:bg-brand-50",
            )}
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold"
            >
              {initials || <UserIcon className="h-5 w-5" />}
            </span>
            <span className="hidden max-w-32 truncate text-sm font-medium sm:block">
              {firstName}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0 transition-transform",
                menuOpen && "rotate-180",
              )}
            />
          </button>
          {menuOpen && (
            <nav
              id={menuId}
              aria-label="Account"
              className="absolute right-0 top-full mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-brand-100 bg-white p-2 shadow-lg"
            >
              <Link
                href="/settings"
                aria-current={pathname === "/settings" ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  entryStyle,
                  pathname === "/settings"
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-700 hover:bg-brand-50 hover:text-brand-700",
                )}
              >
                <AdjustmentsHorizontalIcon
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0"
                />
                Preferences
              </Link>
              <Link
                href="/pricing"
                aria-current={pathname === "/pricing" ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  entryStyle,
                  pathname === "/pricing"
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-700 hover:bg-brand-50 hover:text-brand-700",
                )}
              >
                <CreditCardIcon
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0"
                />
                Plan &amp; billing
              </Link>
              <hr className="my-2 border-surface-200" />
              <button
                type="button"
                onClick={signOut}
                disabled={pending}
                className={cn(
                  entryStyle,
                  "text-gray-700 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <ArrowRightStartOnRectangleIcon
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0"
                />
                {pending ? "Signing out…" : "Sign out"}
              </button>
              {logoutError && (
                <p role="alert" className="px-3 py-2 text-xs text-red-700">
                  Unable to sign out. Please try again.
                </p>
              )}
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
