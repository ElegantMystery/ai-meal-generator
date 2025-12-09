import Link from "next/link"

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8 space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900 text-center">
          AI Costco / Trader Joe’s Meal Generator
        </h1>
        <p className="text-gray-600 text-center text-sm">
          Sign in to start generating meal plans from your favorite stores.
        </p>

        <div className="flex justify-center">
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-6 py-2.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
