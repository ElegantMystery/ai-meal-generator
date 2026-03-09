"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSubscription } from "@/hooks/useSubscription";
import { createCheckoutSession, createPortalSession } from "@/lib/api";
import { navigateTo } from "@/lib/navigate";
import { useToast } from "@/components/ui/Toast";

const FREE_FEATURES = [
  "3 meal plans",
  "AI & rule-based generation",
  "Shopping list export",
];

const PRO_FEATURES = [
  "Unlimited meal plans",
  "Everything in Free",
  "Priority support",
];

function FeatureList({ features }: { features: string[] }) {
  return (
    <ul className="space-y-2 mt-4">
      {features.map((f) => (
        <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
          <CheckIcon className="h-4 w-4 text-brand-600 shrink-0" />
          {f}
        </li>
      ))}
    </ul>
  );
}

function PricingCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-1/3 mb-2" />
        <Skeleton className="h-8 w-1/2" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3 mt-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-9 w-full mt-4" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PricingPage() {
  const { status, loading } = useSubscription();
  const { toast } = useToast();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    try {
      const { url } = await createCheckoutSession();
      navigateTo(url);
    } catch (err) {
      console.error("Failed to start checkout:", err);
      toast("Failed to start checkout. Please try again.", "error");
      setCheckoutLoading(false);
    }
  };

  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const { url } = await createPortalSession();
      navigateTo(url);
    } catch (err) {
      console.error("Failed to open billing portal:", err);
      toast("Failed to open billing portal. Please try again.", "error");
      setPortalLoading(false);
    }
  };

  const isPro = status?.tier === "PRO";

  return (
    <main className="max-w-3xl mx-auto py-8 px-4">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition mb-6"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Dashboard
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        Plans &amp; Pricing
      </h1>
      <p className="text-gray-500 text-sm mb-8">
        Choose the plan that fits your needs.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* FREE card */}
        {loading ? (
          <PricingCardSkeleton />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Free</CardTitle>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                $0
                <span className="text-base font-normal text-gray-500">/mo</span>
              </p>
            </CardHeader>
            <CardContent>
              <FeatureList features={FREE_FEATURES} />
              <div className="mt-6">
                {!isPro ? (
                  <Button variant="secondary" className="w-full" disabled>
                    Current Plan
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )}

        {/* PRO card */}
        {loading ? (
          <PricingCardSkeleton />
        ) : (
          <Card className="border-brand-600 border-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Pro</CardTitle>
                {isPro && <Badge variant="success">Current Plan</Badge>}
              </div>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                $9
                <span className="text-base font-normal text-gray-500">/mo</span>
              </p>
            </CardHeader>
            <CardContent>
              <FeatureList features={PRO_FEATURES} />
              <div className="mt-6">
                {isPro ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleManageBilling}
                    loading={portalLoading}
                    disabled={portalLoading}
                  >
                    Manage Billing
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={handleUpgrade}
                    loading={checkoutLoading}
                    disabled={checkoutLoading}
                  >
                    Upgrade to PRO
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
