@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ===================================================================
REM  CLPD learning spine - local playground
REM  Double-click this file, then open http://localhost:4000/playground
REM
REM  Everything this script prints is also written to start-log.txt in
REM  this folder, so if it fails there is a record to look at.
REM ===================================================================

set LOG=%~dp0start-log.txt
echo CLPD playground start - %DATE% %TIME% > "%LOG%"

set NODE_ENV=development
set JWT_SECRET=local-dev-only-secret-at-least-32-characters-long
set DATABASE_URL=./data/local.sqlite

echo.
echo   CLPD learning spine - local playground
echo   ---------------------------------------------
echo.

REM ---- Node present? ------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   PROBLEM: Node.js is not installed, or not on PATH.
  echo   PROBLEM: Node.js is not installed, or not on PATH. >> "%LOG%"
  echo.
  echo   Install the LTS build from https://nodejs.org
  echo   then close this window and run this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node --version') do set NODEV=%%v
echo   Node %NODEV%
echo   Node %NODEV% >> "%LOG%"

REM ---- Dependencies -------------------------------------------------
if not exist node_modules (
  echo   Installing dependencies. First run only - this takes a minute or two.
  echo   Installing dependencies >> "%LOG%"
  echo.
  call npm ci --no-audit --no-fund >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo   PROBLEM: npm ci failed. See start-log.txt in this folder.
    echo.
    echo   The usual cause is better-sqlite3 needing to compile because
    echo   there is no prebuilt binary for this Node version. Installing
    echo   the current Node LTS normally fixes it.
    echo.
    pause
    exit /b 1
  )
  echo   Dependencies installed.
) else (
  echo   Dependencies already present.
)

REM ---- Database -----------------------------------------------------
echo   Applying migrations...
call npm run --silent migrate >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   PROBLEM: migrations failed. See start-log.txt in this folder.
  echo.
  pause
  exit /b 1
)

echo   Seeding the demo topic...
call npm run --silent seed:demo-spine >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   PROBLEM: seeding failed. See start-log.txt in this folder.
  echo.
  pause
  exit /b 1
)

echo   Running the checks...
call npm run --silent test:learning >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   NOTE: some checks did not pass. See start-log.txt.
  echo   The server will still start.
)

REM ---- Go -----------------------------------------------------------
echo.
echo   ---------------------------------------------
echo    READY. Open this in your browser:
echo.
echo       http://localhost:4000/playground
echo.
echo    Leave this window open. Ctrl-C stops the server.
echo   ---------------------------------------------
echo.

start "" http://localhost:4000/playground
call npm start

echo.
echo   The server has stopped.
pause
