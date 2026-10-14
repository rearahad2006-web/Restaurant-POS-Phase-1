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

Install only the POS workspace and its workspace dependencies from the repository root:

```sh
pnpm install --filter @workspace/restaurant-pos... --frozen-lockfile
```

Typecheck with:

```sh
pnpm --filter @workspace/restaurant-pos run typecheck
```

## Development sign-in

- Manager: `manager` / `2468`
- Username: `cashier`
- PIN: `1234`

Both visible sample accounts are development-only. Local PIN sign-in is not secure production authentication. Managers can configure local accounts and restaurant settings; Cashiers are limited to POS, Orders, and Payments.

The Manager Panel includes Dashboard, POS, Orders, Payments, Expenses, Menu, Tables, Reports, Staff, and Settings. Managers can record and filter local expenses, including direct-total expenses, and review sales, expenses, and net amount in Reports. Restaurant logos are saved in local settings and included on receipts. Cash checkout records received cash and change; non-cash payments can store an optional reference. Legacy embedded payment data is migrated into the separate local payment ledger when loaded.

## Storage modes and portability

Replit Preview and the Vite development server use browser local storage through `BrowserLocalRepository`. That data is local to the current browser profile, is not shared across devices, and may be removed if browser data is cleared. The local Node service is separate: it serves the same POS UI in SQLite mode and does not use the workspace API server, PostgreSQL, Replit authentication, or cloud APIs.

## Local Windows run (unpackaged)

This launch method uses the existing local Node service. It is a command-file launch, not an installer. It has **not** been run on Windows from this workspace.

### Prerequisites

- Windows 10 x64.
- Node.js 22.12 or newer in the 22.x line.
- pnpm 10.26.1. The launcher installs only the POS production dependencies with the existing frozen lockfile.

### Prepare the web files in Replit

The workspace lock configuration excludes Windows Vite/Rollup/Tailwind native build binaries. To keep the lockfile unchanged, build the static UI in Replit/Linux, then copy the generated directory to the same relative path in the Windows checkout:

```sh
pnpm --filter @workspace/restaurant-pos run build:local
```

Copy `artifacts/restaurant-pos/dist/public` to `artifacts/restaurant-pos/dist/public` in the Windows checkout. Do not run the Vite build on Windows with the current frozen lockfile.

### Start and stop

From the Windows checkout, run:

```text
artifacts\restaurant-pos\scripts\start-windows.cmd
```

The launcher installs production dependencies using the frozen workspace lockfile, then starts the existing SQLite service. Open `http://127.0.0.1:4317`. The service binds to loopback; it is not exposed to other computers on the network. Press **Ctrl+C** in the launcher window to stop it.

The database and verified backups are stored outside the checkout:

- Database: `%LOCALAPPDATA%\JuniperPOS\restaurant-pos.sqlite`
- Backups: `%LOCALAPPDATA%\JuniperPOS\backups`

### First-time manager setup

The first local launch requires a browser migration JSON. In Replit Preview, use **Settings → Export and backup → Download migration JSON**. Keep a separate copy of that file. On the Windows register, choose it at **Import existing data**, then create a fresh Manager PIN at **Create manager access**. Imported staff PINs are cleared; after manager sign-in, set cashier PINs from **Staff**. Do not import into a data folder that contains records or a backup you need to preserve.

### Back up and recover

While signed in as Manager on the local register, use **Settings → Export and backup → Create verified SQLite backup**. The app saves a verified copy under the backups directory above. Use the in-app restore control when the live database can start.

If startup refuses because the live database is missing or damaged, do not delete or move any backup. Stop the service and copy the entire `JuniperPOS` folder to a separate safe location first. To recover manually, rename any damaged `restaurant-pos.sqlite` file instead of deleting it, then **copy** a chosen verified `restaurant-pos-*.sqlite` backup to `%LOCALAPPDATA%\JuniperPOS\restaurant-pos.sqlite` and start the launcher again. The service validates the database before opening it. Do not copy the active database while the service is running.

## Receipts

Receipt previews, print, and reprint use the same saved order and payment snapshots. Receipts include restaurant details, optional logo, item quantities and unit prices, totals, and payment details. Print/Reprint opens the browser print dialog only; no physical printer connection is provided.

## Project structure

- `src/App.tsx` — application screens and POS flows
- `src/domain.ts` — data models and domain types
- `src/storage/repository.ts` — sample data and local persistence adapter
- `src/services/printing.ts` — receipt preview/print boundary
- `src/index.css` — shared application styling

## Scope limits

The register intentionally excludes inventory, kitchen display/KOT, reservations, online ordering, cloud sync, multi-restaurant support, subscriptions, desktop packaging, and physical printer integrations. The Windows launch method is not an installer, and the Windows runtime still requires testing on the target laptop. Restaurant, menu, and account details are sample data and should be reviewed before operational use.
