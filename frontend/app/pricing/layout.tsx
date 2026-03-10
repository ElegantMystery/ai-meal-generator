import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Start free with 3 meal plans/month, or upgrade to PRO for $4.99/mo and get unlimited AI-generated meal plans.",
  openGraph: {
    title: "Pricing – Whole Haul",
    description: "Start free with 3 meal plans/month, or upgrade to PRO for $4.99/mo and get unlimited AI-generated meal plans.",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
