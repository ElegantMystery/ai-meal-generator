import Link from 'next/link';
import { AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';

export type DashboardPreferencesData = {
  dietaryRestrictions: string | null;
  allergies: string | null;
  targetCaloriesPerDay: number | null;
} | null;
export type PreferenceState = 'loading' | 'error' | 'ready';

export function DashboardPreferences({ prefs, state }: { prefs: DashboardPreferencesData; state: PreferenceState }) {
  const diet = prefs?.dietaryRestrictions?.trim().replaceAll('-', ' ');
  const allergies = prefs?.allergies?.split(';').map(value => value.trim()).filter(Boolean).join(', ');
  const target = prefs?.targetCaloriesPerDay;
  return <section aria-label="Saved preferences" className="space-y-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-medium text-gray-700">Made for you</p>
      <Link href="/settings" className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-brand-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
        <AdjustmentsHorizontalIcon aria-hidden="true" className="h-4 w-4" />Edit preferences
      </Link>
    </div>
    {state === 'loading' ? <p role="status" className="text-gray-500">Loading preferences…</p> : state === 'error' ?
      <p role="status" className="text-red-700">Preferences unavailable. Check your settings before generating.</p> :
      <ul className="flex flex-wrap gap-2 text-brand-800">
        {[diet ? diet[0].toUpperCase() + diet.slice(1) : 'Diet not set', allergies ? `Allergies: ${allergies}` : 'Allergies not set', typeof target === 'number' && Number.isFinite(target) && target > 0 ? `Target: ${target.toLocaleString('en-US')} kcal / person / day` : 'Calorie target not set'].map(value =>
          <li key={value} className="max-w-full break-words rounded-lg bg-brand-50 px-3 py-2">{value}</li>)}
      </ul>}
  </section>;
}
