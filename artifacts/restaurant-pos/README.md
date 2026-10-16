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

## Electron desktop shell (Phase 1)

The Electron main process starts the existing SQLite HTTP service on an ephemeral loopback port and opens that same-origin URL. It uses `%LOCALAPPDATA%\JuniperPOS` for the database and backups, matching the existing Windows service. There is no installer or auto-updater in this phase.

Electron 44.7.2 embeds Node 24.21.0. The current `better-sqlite3` 12.6.0 supports Node 24, but its native addon must still be rebuilt for Electron's ABI. The rebuild tool and Electron CLI require Node 22.12 or newer. The Electron rebuild command recompiles the POS workspace's native addon in place; do not run it in a checkout that must continue using the Node-based `start:local` launcher until the Node ABI is restored. Native rebuilding and Windows Electron startup have not been verified from this workspace.

After installing the POS development dependencies, the explicit commands are:

```sh
pnpm --filter @workspace/restaurant-pos run electron:rebuild-native
pnpm --filter @workspace/restaurant-pos run electron
```

The native rebuild should be moved to an isolated packaging/staging directory before using Electron and the existing Node launcher interchangeably.

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

The workspace lock configuration excludes Windows Vite/Rollup/Tailwind native build binaries. To keep the lockfile unchanged, build the static UI in Replit/Linux:

```sh
pnpm --filter @workspace/restaurant-pos run build:local
test -f artifacts/restaurant-pos/dist/public/index.html
```

The build output is `artifacts/restaurant-pos/dist/public/`. Transfer that directory to the Windows machine. In PowerShell, from the Windows checkout root, copy the **contents** of the transferred `dist\public` directory into the matching checkout path. Set `$source` to the actual transferred directory:

```powershell
$source = Read-Host "Path to the transferred dist\public directory"
$destination = ".\artifacts\restaurant-pos\dist\public"
if (-not (Test-Path (Join-Path $source "index.html"))) { throw "Build output must contain index.html." }
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $destination -Recurse -Force
if (-not (Test-Path (Join-Path $destination "index.html"))) { throw "Copy did not place index.html in the checkout." }
```

Do not run the Vite build on Windows with the current frozen lockfile.

### Install, start, stop, and restart

From the Windows checkout root, the launcher checks for Node.js, pnpm, and the built `index.html`. It then runs this frozen production-only install; the install is also performed automatically each time the launcher starts:

```powershell
pnpm install --prod --filter @workspace/restaurant-pos... --frozen-lockfile
```

No dependency versions or lockfile entries are changed by this command. The local service starts through the existing `start:local` package script (`node ./server/index.mjs`).

Start the register from PowerShell at the Windows checkout root:

```powershell
& ".\artifacts\restaurant-pos\scripts\start-windows.cmd"
```

Open `http://127.0.0.1:4317`. The service binds only to loopback (`127.0.0.1`), not to the network. Keep the launcher window open while using the register. To stop it, press **Ctrl+C** once in that window and wait for it to exit. To restart, run the same `.cmd` command again and sign in again; service sessions are cleared on restart.

The database and verified backups are stored outside the checkout:

- Database: `%LOCALAPPDATA%\JuniperPOS\restaurant-pos.sqlite`
- Backups: `%LOCALAPPDATA%\JuniperPOS\backups`

### First-time manager setup

For a safe launch test, use a separate disposable Windows user profile (or a disposable Windows machine) so `%LOCALAPPDATA%\JuniperPOS` is not the restaurant's live data folder. Use only sample/test data during this procedure.

1. In Replit Preview, use **Settings → Export and backup → Download migration JSON**. Keep an unchanged copy of the export outside the checkout.
2. Start the Windows launcher and open the register. On the empty local database, choose **Import existing data** and select that migration JSON.
3. At **Create manager access**, set a new Manager username and private PIN; do not use the Replit development PIN. Imported staff PINs are cleared. After signing in, set any required Cashier PINs in **Staff**.

Do not import into a data folder that contains records or backups you need to preserve. The local service does not seed the Replit demo accounts into SQLite. A new database is empty and requires the explicit import/manager-setup steps above. Existing empty, damaged, unsupported, or incompatible databases are rejected rather than initialized from sample data. If startup reports a database error, stop and preserve the whole data folder; do not delete files or try to make the register appear empty.

### Test order/payment persistence across restart

Use only the disposable profile and sample/test records:

1. Create and pay a clearly identifiable test order. Note its order number, payment method, and amount; for cash, also note amount received and change.
2. Confirm that order appears in **Orders** and the matching payment appears in **Payments**.
3. Stop the service with **Ctrl+C**, wait for the launcher to exit, then start it again with the same `.cmd` command.
4. Sign in again and confirm the same order and payment details remain in **Orders** and **Payments**.

### Test backup and recovery safely

Restore replaces the current database. Test it only in the disposable Windows profile/machine with sample data, never in a profile containing restaurant records.

1. While signed in as Manager, use **Settings → Export and backup → Create verified SQLite backup**. Note the backup filename in `%LOCALAPPDATA%\JuniperPOS\backups`.
2. Create and pay a second identifiable test order after that backup.
3. Use the in-app restore control to restore the earlier verified backup and confirm the replacement. Sign in again if prompted.
4. Confirm the order created before the backup remains, the later test order is absent, and a new verified safety backup was created for the pre-restore database.

For file-level recovery after a startup refusal, stop the service first and copy the entire `JuniperPOS` folder to a separate safe location. Do not delete or move any backup. Rename the damaged `restaurant-pos.sqlite` and any existing `restaurant-pos.sqlite-wal`, `restaurant-pos.sqlite-shm`, or `restaurant-pos.sqlite-journal` sidecars instead of deleting them. Then **copy** a chosen verified `restaurant-pos-*.sqlite` backup to `%LOCALAPPDATA%\JuniperPOS\restaurant-pos.sqlite` and start the launcher again. The service validates the database before opening it; if the live database is missing while verified backups exist, startup refuses to initialize a blank register. Never copy the active database while the service is running.

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
