@echo off
setlocal
title Atlas - Google Maps Data Console
cd /d "%~dp0"

echo ============================================
echo   Atlas - Google Maps Data Console
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo Install it from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

rem --- Backend setup (first run only) ---
if not exist "server\node_modules" (
  echo [setup] Installing backend dependencies...
  pushd server
  call npm install || goto :fail
  echo [setup] Downloading Chromium for Playwright...
  call npx playwright install chromium || goto :fail
  popd
)

rem --- Frontend setup (first run only) ---
if not exist "web\node_modules" (
  echo [setup] Installing frontend dependencies...
  pushd web
  call npm install || goto :fail
  popd
)

echo.
echo [run] Starting backend (http://localhost:5174)...
start "Atlas Backend" /d "%~dp0server" cmd /k npm run dev

echo [run] Starting frontend...
start "Atlas Frontend" /d "%~dp0web" cmd /k npm run dev

rem Give Vite a moment to boot, then open the app in the browser.
timeout /t 5 /nobreak >nul
start "" http://localhost:5173

echo.
echo Both servers are starting in their own windows.
echo Close those windows to stop the app.
echo.
exit /b 0

:fail
echo.
echo [ERROR] Setup failed. See the message above.
popd
pause
exit /b 1
