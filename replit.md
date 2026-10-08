# Restaurant POS Phase 1

A local-first Phase 1 point-of-sale app for a small family restaurant, built around dine-in, takeaway, and delivery checkout.

## Run & Operate

- `pnpm --filter @workspace/restaurant-pos run dev` — run the POS web app (the managed Replit workflow supplies its required environment).
- `pnpm --filter @workspace/restaurant-pos run typecheck` — check the POS TypeScript.
- `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/restaurant-pos run build` — build the POS frontend outside the managed workflow.
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The POS does not use the API server or a database. `DATABASE_URL` is for the separate API-server starter only.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- POS: React, TypeScript, Vite, and a browser-local repository adapter
- POS receipts: isolated browser print fallback; no thermal-printer driver is connected
- The workspace also retains an unused Express/PostgreSQL API starter.

## Where things live

- `artifacts/restaurant-pos/src/App.tsx` — POS screens and application flows
- `artifacts/restaurant-pos/src/domain.ts` — POS data types and business models
- `artifacts/restaurant-pos/src/storage/repository.ts` — seeded local storage and replaceable repository boundary
- `artifacts/restaurant-pos/src/services/printing.ts` — isolated receipt printing
- `artifacts/restaurant-pos/src/index.css` — app visual tokens and global styles
- `artifacts/restaurant-pos/README.md` — usage, demo sign-in, data limits, and local run instructions

## Architecture decisions

- POS data stays in this browser's local storage behind a repository interface; do not connect it to the Replit database.
- Receipt rendering and browser printing are isolated so native Windows thermal printing can be added later.
- The cashier account is development-only and must not be treated as production-grade authentication.
- Replit preview is for development; Windows offline operation still needs a local app shell and SQLite adapter.

## Product

Phase 1 provides role-aware Manager and Cashier access; a dashboard; dine-in, takeaway, and delivery checkout; separate payment records; receipt preview and reprint; menu, category, and table management; searchable orders; reports; staff accounts; and restaurant/receipt settings. Sample data is clearly marked. There is no inventory, KDS, KOT, reservations, online ordering, sync, or multi-restaurant support.

## User preferences

- Keep the POS local-first and portable to a single Windows 10 restaurant computer; avoid Replit-specific storage and cloud dependencies for core billing.
- Keep changes within the specified Phase 1 feature set; do not add the deferred local database, Windows packaging, thermal printer, inventory, kitchen display, or other Phase 2 work unless requested.

## Gotchas

- Browser-local data is tied to this browser profile and is not shared, backed up, or protected from browser-data clearing.
- Browser printing is not thermal-printer integration. Do not use this build for live restaurant operations until persistence, backups, packaging, and printer support are addressed.
- Keep browser-local persistence for this phase; do not begin SQLite, Windows packaging, thermal printing, inventory, or kitchen-display work without an explicit request.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
