import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to Whole Haul with Google to start generating AI meal plans from Trader Joe's and Costco.",
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
