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

- Username: `cashier`
- PIN: `1234`

This is a visible sample cashier account for development only, not secure production authentication.

## Storage and portability

The POS persists its data in this browser's local storage through a `RestaurantRepository` boundary. It does not use the workspace API server, PostgreSQL, Replit authentication, or cloud APIs. Data is local to the current browser profile: it is not shared across devices or automatically backed up, and clearing browser data may remove it.

The repository boundary is the replacement point for SQLite in a future Windows installation. The Replit preview is not itself an offline Windows app; a local app shell and local database still need to be implemented before the restaurant can rely on it without internet access.

## Receipts

Receipt data and print behavior are isolated in `src/services/printing.ts`. The current Print/Reprint action uses the browser print dialog. It does not connect to a 58mm/80mm thermal printer or a Windows printer driver.

## Project structure

- `src/App.tsx` — application screens and POS flows
- `src/domain.ts` — data models and domain types
- `src/storage/repository.ts` — sample data and local persistence adapter
- `src/services/printing.ts` — receipt preview/print boundary
- `src/index.css` — shared application styling

## Phase 1 scope limits

This build does not include inventory, kitchen display, KOT, reservations, online ordering, cloud sync, multi-restaurant support, or subscriptions. The included restaurant and menu are sample data, not the restaurant's actual configuration.

## Next development step

Run the seven acceptance workflows from the project brief end-to-end and resolve any issues. After Phase 1 sign-off, replace browser storage with local SQLite and package a Windows app; then connect and test the physical receipt printer.
