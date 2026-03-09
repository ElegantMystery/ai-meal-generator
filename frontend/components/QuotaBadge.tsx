"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";

interface QuotaBadgeProps {
  tier: string;
  remainingQuota: number;
}

export default function QuotaBadge({ tier, remainingQuota }: QuotaBadgeProps) {
  if (tier === "PRO") {
    return null;
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
