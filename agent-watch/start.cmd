@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Agent Watch requires Node.js 20 or newer.
  echo Download it from https://nodejs.org/
  pause
  exit /b 1
)
node src\server.js --open
if errorlevel 1 pause

