"use client";

import { useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import { Button } from "@/components/ui/Button";
import { createCheckoutSession } from "@/lib/api";
import { navigateTo } from "@/lib/navigate";
import { useToast } from "@/components/ui/Toast";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
}

export default function UpgradeModal({ open, onClose }: UpgradeModalProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const { url } = await createCheckoutSession();
      navigateTo(url);
    } catch (err) {
      console.error("Failed to create checkout session:", err);
      toast("Failed to start checkout. Please try again.", "error");
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal isOpen={open} onClose={onClose} size="md">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">
          You&apos;ve reached your free plan limit
        </h2>
        <p className="text-sm text-gray-600">
          Upgrade to PRO for unlimited meal plan generation.
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="primary"
            className="w-full"
            onClick={handleUpgrade}
            loading={loading}
            disabled={loading}
          >
            Upgrade to PRO
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={onClose}
            disabled={loading}
          >
            Maybe Later
          </Button>
        </div>
        <div className="text-center pt-1">
          <Link
            href="/pricing"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 transition"
          >
            Compare plans →
          </Link>
        </div>
      </div>
    </Modal>
  );
}
