# Restaurant POS — Phase 1

A local-first POS for a small family restaurant. It supports dine-in, takeaway, and delivery orders, with a role-aware Manager Panel, checkout, separate payment records, menu and table management, receipts, searchable orders, reports, staff accounts, and restaurant settings.

## Run in Replit

Open the **Restaurant POS** preview. Its managed workflow runs:

```sh
pnpm --filter @workspace/restaurant-pos run dev
```

For a local development server in a Unix-like shell:

```sh
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/restaurant-pos run dev
```

In Windows PowerShell:

```powershell
$env:PORT = "5173"
$env:BASE_PATH = "/"
pnpm --filter @workspace/restaurant-pos run dev
```

Install workspace dependencies from the repository root with `pnpm install` first. Typecheck with:

```sh
pnpm --filter @workspace/restaurant-pos run typecheck
```

## Development sign-in

- Manager: `manager` / `2468`
- Username: `cashier`
- PIN: `1234`

Both visible sample accounts are development-only. Local PIN sign-in is not secure production authentication. Managers can configure local accounts and restaurant settings; Cashiers are limited to POS, Orders, and Payments.

The Manager Panel includes Dashboard, Orders, Payments, Menu, Tables, Reports, Staff, and Settings. Cash checkout records received cash and change; non-cash payments can store an optional reference. Legacy embedded payment data is migrated into the separate local payment ledger when loaded.

## Storage and portability

The POS persists its data in this browser's local storage through a `RestaurantRepository` boundary. It does not use the workspace API server, PostgreSQL, Replit authentication, or cloud APIs. Data is local to the current browser profile: it is not shared across devices or automatically backed up, and clearing browser data may remove it.

The repository boundary keeps storage isolated in the browser-local adapter. This build does not provide cloud sync or external services.

## Receipts

Receipt data and print behavior are isolated in `src/services/printing.ts`. Print/Reprint opens the browser print dialog only; no physical printer connection is provided.

## Project structure

- `src/App.tsx` — application screens and POS flows
- `src/domain.ts` — data models and domain types
- `src/storage/repository.ts` — sample data and local persistence adapter
- `src/services/printing.ts` — receipt preview/print boundary
- `src/index.css` — shared application styling

## Phase 1 scope limits

The register intentionally excludes inventory, kitchen display/KOT, reservations, online ordering, cloud sync, multi-restaurant support, subscriptions, local database engines, desktop packaging, and physical printer integrations. Restaurant, menu, and account details are sample data and should be reviewed before operational use.
