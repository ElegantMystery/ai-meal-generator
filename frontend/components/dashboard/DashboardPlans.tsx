'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRightIcon, CalendarDaysIcon, ShoppingBagIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatDateRange } from '@/lib/formatters';
import { initialDayIndex, previewDays, type SavedPlan } from '@/lib/dashboard-plan-utils';

export type BasketState = { state: 'loading' | 'error' } | { state: 'ready'; total: number | null };
const linkStyle = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600';

function GroceryIllustration() {
  return <svg aria-hidden="true" viewBox="0 0 180 160" className="h-32 w-36 shrink-0 text-brand-600">
    <circle cx="90" cy="80" r="72" fill="currentColor" opacity=".06" />
    <path d="M53 61h74l-8 78H61z" fill="currentColor" opacity=".17" />
    <path d="M71 64V49a19 19 0 0 1 38 0v15" fill="none" stroke="currentColor" strokeWidth="3" />
    <path d="M85 69C39 52 58 18 86 51c-7-37 30-48 20-5 22-18 41 3-3 26" fill="currentColor" opacity=".6" />
    <path d="m71 95 10 10 26-27" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Mount with the plan id as key so changing the featured plan resets day selection. */
export function FeaturedPlan({ plan, today, basket }: { plan: SavedPlan; today: string; basket: BasketState }) {
  const days = useMemo(() => previewDays(plan.planJson), [plan.planJson]);
  const [selected, setSelected] = useState(() => initialDayIndex(days, today));
  const day = days[selected] ?? days[0];
  return <section aria-label="Featured meal plan" className="overflow-hidden rounded-xl border border-brand-100 bg-white shadow-sm">
    <div className="grid lg:grid-cols-[1fr_18rem]">
      <div className="min-w-0 p-5 sm:p-7">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-brand-600">Your meal plan</p>
        <h2 className="break-words font-brand text-2xl text-brand-900 sm:text-3xl">{plan.title}</h2>
        <p className="mt-2 text-sm text-gray-500">{formatDateRange(plan.startDate, plan.endDate)}</p>
        {days.length > 0 && <div aria-label="Plan days" className="my-6 flex flex-wrap gap-2">
          {days.map((candidate, index) => <button key={`${candidate.date}-${index}`} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)} className={cn('min-h-12 rounded-lg border px-3 py-2 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600', selected === index ? 'border-brand-600 bg-brand-600 text-white' : 'border-surface-200 bg-surface-50 text-gray-700 hover:border-brand-400')}>
            {new Date(`${candidate.date}T12:00:00`).toLocaleDateString('en-US', {month:'short',day:'numeric'})}{candidate.date === today && <span className="block text-xs">Today</span>}
          </button>)}
        </div>}
        <div aria-live="polite" className="mt-6">
          {!day ? <p className="text-sm text-gray-500">Day preview unavailable. Your saved plan is still accessible.</p> : <>
            <h3 className="mb-4 text-sm font-semibold text-gray-700">{new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</h3>
            {day.meals.length === 0 ? <p className="text-sm text-gray-500">No meal preview available for this day.</p> : <ul className="space-y-4">
              {day.meals.map((meal,index) => <li key={index} className="border-l-2 border-brand-200 pl-4">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{meal.name}</p>
                {meal.dishes.length ? meal.dishes.map((dish,dishIndex) => <div key={dishIndex} className="mt-1">
                  <p className="break-words text-base font-semibold text-gray-900">{dish.name}</p>
                  {dish.description && <p className="mt-1 break-words text-sm leading-relaxed text-gray-500">{dish.description}</p>}
                </div>) : <p className="mt-1 break-words text-sm text-gray-700">{meal.itemNames.join(', ') || 'Open the plan for details.'}</p>}
              </li>)}
            </ul>}
          </>}
        </div>
        <Link href={`/mealplans/${plan.id}`} className={cn(linkStyle,'mt-6 bg-brand-600 text-white hover:bg-brand-700')}>View plan<ArrowUpRightIcon aria-hidden="true" className="h-4 w-4" /></Link>
      </div>
      <aside className="flex flex-col justify-between gap-5 border-t border-brand-100 bg-brand-50 p-5 sm:p-7 lg:border-t-0 lg:border-l">
        <div><GroceryIllustration /><h3 className="mt-3 font-brand text-xl text-brand-900">From plan to pantry</h3><p className="mt-2 text-sm leading-relaxed text-gray-600">Your ingredients, gathered into one shopping list.</p></div>
        <div>
          {basket.state === 'loading' ? <p role="status" className="text-sm text-gray-500">Loading basket estimate…</p> : basket.state === 'error' || basket.total === null ? <p className="text-sm text-gray-500">Basket estimate unavailable</p> : <><p className="text-xs font-medium text-gray-600">Estimated basket</p><p className="mt-1 text-3xl font-semibold text-brand-900">${basket.total.toFixed(2)}</p><p className="mt-1 text-xs text-gray-500">For the full plan · prices may vary</p></>}
          <Link href={`/mealplans/${plan.id}`} className={cn(linkStyle,'mt-4 w-full border border-brand-200 bg-white text-brand-700 hover:bg-brand-100')}><ShoppingBagIcon aria-hidden="true" className="h-5 w-5" />Shopping list</Link>
        </div>
      </aside>
    </div>
  </section>;
}

export function PlanHistory({ plans }: { plans: SavedPlan[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!plans.length) return null;
  return <section aria-label="Previous plans" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-brand text-2xl text-brand-900">Your collection</h2><p className="mt-1 text-sm text-gray-500">Good meals worth coming back to.</p></div><span className="text-sm text-gray-500">{plans.length} saved {plans.length === 1 ? 'plan' : 'plans'}</span></div>
    <ul className="grid gap-4 sm:grid-cols-2">
      {(expanded ? plans : plans.slice(0,4)).map((plan,index) => <li key={plan.id}>
        <Link href={`/mealplans/${plan.id}`} className="group flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-surface-200 bg-white shadow-sm transition hover:border-brand-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
          <div className={cn('relative flex h-24 items-center overflow-hidden px-5', index % 2 ? 'bg-accent-50' : 'bg-brand-50')} aria-hidden="true"><CalendarDaysIcon className="h-8 w-8 text-brand-600" /><div className="absolute -right-6 -top-12 h-40 w-40 rounded-full border-[24px] border-brand-100/60" /><div className="absolute right-20 -bottom-9 h-24 w-24 rounded-full border-[16px] border-brand-200/30" /></div>
          <div className="flex flex-1 items-start justify-between gap-3 p-5"><div className="min-w-0"><h3 className="break-words font-brand text-xl text-gray-900 group-hover:text-brand-600">{plan.title}</h3><p className="mt-2 text-sm text-gray-500">{formatDateRange(plan.startDate, plan.endDate)}</p></div><ArrowUpRightIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-brand-600" /></div>
        </Link>
      </li>)}
    </ul>
    {plans.length > 4 && <Button variant="secondary" className="min-h-11" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer plans' : `Show all ${plans.length} plans`}</Button>}
  </section>;
}
