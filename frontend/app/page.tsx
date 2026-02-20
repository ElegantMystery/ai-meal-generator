import Image from "next/image";
import Link from "next/link";
import {
  AdjustmentsHorizontalIcon,
  SparklesIcon,
  ShoppingCartIcon,
} from "@heroicons/react/24/outline";

const steps = [
  {
    icon: AdjustmentsHorizontalIcon,
    title: "Set your preferences",
    description:
      "Tell us your dietary restrictions, allergies, and calorie goals. We tailor every plan to you.",
  },
  {
    icon: SparklesIcon,
    title: "AI builds your meal plan",
    description:
      "Our AI picks meals from real Trader Joe's and Costco items — balanced, realistic, and within budget.",
  },
  {
    icon: ShoppingCartIcon,
    title: "Get your shopping list",
    description:
      "One-tap shopping list with prices and quantities. Walk in, grab what you need, done.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* ── Navbar ── */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/icon.png" alt="Whole Haul" width={32} height={32} className="rounded-lg" />
            <Image src="/whole_haul.png" alt="Whole Haul" width={110} height={24} className="object-contain" />
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition px-3 py-1.5"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-24 bg-gradient-to-b from-brand-50 to-white">
        <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
          <div className="inline-flex items-center gap-2 bg-brand-100 text-brand-700 text-xs font-semibold px-3 py-1 rounded-full">
            <SparklesIcon className="h-3.5 w-3.5" />
            Powered by AI
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight tracking-tight">
            Meal planning made simple.
            <br />
            <span className="text-brand-600">Powered by your grocery store.</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-xl mx-auto">
            Generate personalized weekly meal plans using real items from Trader Joe&apos;s and
            Costco — with a ready-to-use shopping list and prices included.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href="/signup"
              className="inline-flex items-center px-6 py-3 rounded-md bg-brand-600 text-white font-medium hover:bg-brand-700 transition text-sm"
            >
              Get Started Free
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center px-6 py-3 rounded-md border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition text-sm"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">How it works</h2>
            <p className="text-gray-500 mt-2 text-sm">Three steps to a full week of meals.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <div key={i} className="flex flex-col items-center text-center gap-4">
                <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-brand-100 text-brand-600">
                  <step.icon className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-brand-600 uppercase tracking-widest mb-1">
                    Step {i + 1}
                  </p>
                  <h3 className="text-base font-semibold text-gray-900">{step.title}</h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stores ── */}
      <section className="py-12 px-4 bg-surface-50 border-y border-gray-100">
        <div className="max-w-2xl mx-auto text-center space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Built for your favorite stores
          </p>
          <div className="flex items-center justify-center gap-8 text-sm font-semibold text-gray-600">
            <span className="px-4 py-2 rounded-lg bg-white border border-gray-200 shadow-sm">
              🛒 Trader Joe&apos;s
            </span>
            <span className="px-4 py-2 rounded-lg bg-white border border-gray-200 shadow-sm">
              📦 Costco
            </span>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 px-4 text-center bg-brand-600">
        <div className="max-w-xl mx-auto space-y-5">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            Ready to simplify your meals?
          </h2>
          <p className="text-brand-100 text-sm">
            Free to start. No credit card required.
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center px-6 py-3 rounded-md bg-white text-brand-700 font-semibold hover:bg-brand-50 transition text-sm"
          >
            Create your free account
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-6 px-4 border-t border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-400">
          <span>© {new Date().getFullYear()} Whole Haul. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/login" className="hover:text-gray-600 transition">Sign in</Link>
            <Link href="/signup" className="hover:text-gray-600 transition">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
