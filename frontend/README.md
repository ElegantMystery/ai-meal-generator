# Whole Haul frontend

Next.js 16 and React 19 provide the browser UI for AI Meal Generator. The app uses
Google OAuth2 session cookies, fetches the Spring API configured by
`NEXT_PUBLIC_API_BASE_URL`, and parses the generation SSE stream in `lib/sse.ts`.

From this directory:

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. For a local backend on another origin, set
`NEXT_PUBLIC_API_BASE_URL=http://localhost:8080`.

Before opening a PR:

```bash
npm test -- --runInBand
npm run lint
npm run build
```

UI components are custom Tailwind components under `components/`; no third-party
component library is used. Use `cn()` from `lib/cn.ts` for conditional classes and
Heroicons for icons. Project-wide setup and contracts are documented in the root
[`README.md`](../README.md); detailed UI conventions are in the
[frontend design system](../docs/frontend-design-system.md).
