@echo off
rem First-time setup: log in to CrowdWorks in Edge, register pages, set up Gmail.
cd /d "%~dp0..\.."
call npm install --no-audit --no-fund
node scripts\cw-patrol.mjs setup
pause
