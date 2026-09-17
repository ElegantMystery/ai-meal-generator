import type { ReactNode } from 'react';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';

type Store = 'TRADER_JOES' | 'WHOLE_FOODS';
type Props = {
  store: Store;
  days: number;
  servings: number;
  busy: boolean;
  onStoreChange: (value: Store) => void;
  onDaysChange: (value: number) => void;
  onServingsChange: (value: number) => void;
  onGenerate: () => void;
  preferences: ReactNode;
};

export function PlanComposer({store,days,servings,busy,onStoreChange,onDaysChange,onServingsChange,onGenerate,preferences}: Props) {
  return <section id="new-plan-composer" aria-labelledby="composer-title" className="rounded-xl bg-brand-800 p-5 shadow-sm sm:p-7">
    <p className="text-xs font-medium uppercase tracking-widest text-brand-200">Your grocery concierge</p>
    <h2 id="composer-title" className="mt-2 font-brand text-3xl text-white">Plan your next haul</h2>
    <p className="mt-2 text-sm leading-relaxed text-brand-100">Meals you’ll look forward to. A shopping list ready to go.</p>
    <form className="mt-6 space-y-4 rounded-xl bg-white p-4 sm:p-5" onSubmit={event => {event.preventDefault(); if (!busy) onGenerate();}}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="col-span-2 sm:col-span-1"><Select id="store" label="Store" className="min-h-11" value={store} onChange={event=>onStoreChange(event.target.value as Store)} disabled={busy}>
          <option value="TRADER_JOES">Trader Joe&apos;s</option><option value="WHOLE_FOODS">Whole Foods</option>
        </Select></div>
        <Select id="days" label="Duration" className="min-h-11" value={days} onChange={event=>onDaysChange(Number(event.target.value))} disabled={busy}>
          {[3,5,7,14].map(value=><option key={value} value={value}>{value} days</option>)}
        </Select>
        <Select id="servings" label="Servings" className="min-h-11" value={servings} onChange={event=>onServingsChange(Number(event.target.value))} disabled={busy}>
          {Array.from({length:12},(_,index)=>index+1).map(value=><option key={value} value={value}>{value}</option>)}
        </Select>
      </div>
      {preferences}
      <Button type="submit" className="min-h-12 w-full" disabled={busy} loading={busy}><SparklesIcon aria-hidden="true" className="h-5 w-5" />{busy ? 'Generating…' : 'Generate with AI'}</Button>
    </form>
  </section>;
}
