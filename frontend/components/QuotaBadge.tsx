"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { createPortalSession } from "@/lib/api";
import { navigateTo } from "@/lib/navigate";
import { useToast } from "@/components/ui/Toast";

interface QuotaBadgeProps {
  tier: string;
  remainingQuota: number;
}

export default function QuotaBadge({ tier, remainingQuota }: QuotaBadgeProps) {
  const { toast } = useToast();

  if (tier === "PRO") {
    const openBillingPortal = async () => {
      try {
        const { url } = await createPortalSession();
        navigateTo(url);
      } catch (error) {
        console.error("Failed to open billing portal:", error);
        toast("Failed to open billing settings. Please try again.", "error");
      }
    };

    return (
      <Badge variant="success" className="inline-flex items-center gap-1">
        <span>PRO</span>
        <span aria-hidden>·</span>
        <span>Unlimited</span>
        <span aria-hidden>·</span>
        <button
          type="button"
          onClick={openBillingPortal}
          className="underline underline-offset-2 hover:opacity-80 transition"
        >
          Manage
        </button>
      </Badge>
    );
  }

  // FREE tier
  if (remainingQuota === 0) {
    return (
      <Badge variant="destructive" className="inline-flex items-center gap-1">
        <span>No plans remaining</span>
        <span aria-hidden>·</span>
        <Link
          href="/pricing"
          className="underline underline-offset-2 hover:opacity-80 transition"
        >
          Upgrade
        </Link>
      </Badge>
    );
  }

  if (remainingQuota === 1) {
    return (
      <Badge variant="warning" className="inline-flex items-center gap-1">
        <span>1 plan remaining</span>
        <span aria-hidden>·</span>
        <Link
          href="/pricing"
          className="underline underline-offset-2 hover:opacity-80 transition"
        >
          Upgrade
        </Link>
      </Badge>
    );
  }

  return <Badge variant="default">{remainingQuota} plans remaining</Badge>;
}
