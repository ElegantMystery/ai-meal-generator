import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: {
    default: "Whole Haul – AI Meal Planner for Trader Joe's & Costco",
    template: "%s | Whole Haul",
  },
  description:
    "Generate personalized weekly meal plans using real Trader Joe's and Costco products. AI-powered, diet-aware, with a ready-to-use shopping list.",
  metadataBase: new URL("https://whole-haul.com"),
  icons: { icon: "/icon.png" },
  openGraph: {
    type: "website",
    siteName: "Whole Haul",
    title: "Whole Haul – AI Meal Planner for Trader Joe's & Costco",
    description:
      "Generate personalized weekly meal plans using real Trader Joe's and Costco products. AI-powered, diet-aware, with a ready-to-use shopping list.",
    url: "https://whole-haul.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Whole Haul – AI Meal Planner for Trader Joe's & Costco",
    description:
      "Generate personalized weekly meal plans using real Trader Joe's and Costco products. AI-powered, diet-aware, with a ready-to-use shopping list.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} antialiased`}
      >
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
