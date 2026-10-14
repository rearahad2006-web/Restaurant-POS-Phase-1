@echo off
setlocal

pushd "%~dp0..\..\.." >nul
if errorlevel 1 (
  echo Could not locate the workspace root from this launcher.
  pause
  exit /b 1
)

if not defined LOCALAPPDATA (
  echo LOCALAPPDATA is not set. Sign in to Windows with a user profile and try again.
  goto :failed
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or is not on PATH.
  goto :failed
)

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm 10.26.1 is required. Install it with Corepack, then try again.
  goto :failed
)

if not exist "artifacts\restaurant-pos\dist\public\index.html" (
  echo The local POS web build is missing.
  echo Build it in the Replit Linux workspace:
  echo   pnpm --filter @workspace/restaurant-pos run build:local
  echo Then copy artifacts\restaurant-pos\dist\public to the same path in this checkout.
  goto :failed
)

set "POS_DATA_DIR=%LOCALAPPDATA%\JuniperPOS"
set "POS_PORT=4317"

echo Installing the locked POS runtime dependencies...
call pnpm install --prod --filter @workspace/restaurant-pos... --frozen-lockfile
if errorlevel 1 goto :failed

echo.
echo Restaurant POS URL: http://127.0.0.1:%POS_PORT%
echo SQLite database: %POS_DATA_DIR%\restaurant-pos.sqlite
echo Verified backups: %POS_DATA_DIR%\backups
echo Press Ctrl+C in this window to stop the POS.
echo.
call pnpm --filter @workspace/restaurant-pos run start:local
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%

:failed
set "EXIT_CODE=1"
popd
pause
exit /b %EXIT_CODE%
