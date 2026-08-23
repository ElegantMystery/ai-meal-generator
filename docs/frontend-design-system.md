# Frontend design system

The UI is light-mode-only and uses custom React/Tailwind components. Do not add a
third-party component library. Use Heroicons v2 (24 px outline) and `cn()` from
`frontend/lib/cn.ts` for conditional classes.

## Tokens

- Primary actions: `brand-600`, hover `brand-700`
- Brand links: `text-brand-600`, hover `text-brand-700`
- Success: `brand-100` / `brand-700`
- Warning: `accent-100` / `accent-600`
- Destructive: Tailwind red scale
- Informational: Tailwind blue scale
- Surfaces and neutrals: `surface-*` and gray scales

Body/UI text uses Geist; monospace uses Geist Mono; brand/display headings use
Playfair Display 700. Form labels are `text-sm font-medium text-gray-700`, errors
are `text-xs text-red-600`, and helper text is `text-xs text-gray-500`.

## Components

- Buttons use the shared `components/ui/Button.tsx` variants and sizes. Preserve
  rounded borders, focus rings, transition, and disabled opacity.
- Cards use a white `rounded-xl` bordered surface with a subtle shadow.
- Badges use the shared semantic variants in `components/ui/Badge.tsx`.
- Modals use the `Modal.tsx` backdrop/dialog structure and must close on Escape
  and backdrop click.
- Toasts appear bottom-right, use semantic left borders, and auto-dismiss after
  four seconds.

Use `max-w-4xl mx-auto py-8 px-4` for standard pages and `space-y-6` between
sections. Existing animations in `app/globals.css` cover fade-in, slide-up, pulse,
and spin states.
