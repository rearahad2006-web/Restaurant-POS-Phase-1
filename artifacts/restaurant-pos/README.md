# Restaurant POS — Phase 1

A local-first POS foundation for a small family restaurant. It supports dine-in, takeaway, and delivery orders, with menu and table management, checkout, payments, receipts, and order history.

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
- `src/storage/repository.ts` — browser-local persistence and legacy payment migration

## Phase 1 scope limits

The register intentionally excludes inventory, kitchen display/KOT, reservations, online ordering, cloud sync, multi-restaurant support, subscriptions, local database engines, desktop packaging, and physical printer integrations. Restaurant, menu, and account details are sample data and should be reviewed before operational use.
