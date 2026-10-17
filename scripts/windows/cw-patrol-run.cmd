@echo off
rem One patrol run (read-only). Log: %USERPROFILE%\.cw-patrol\patrol.log
cd /d "%~dp0..\.."
if not exist "%USERPROFILE%\.cw-patrol" mkdir "%USERPROFILE%\.cw-patrol"
node scripts\cw-patrol.mjs run >> "%USERPROFILE%\.cw-patrol\patrol.log" 2>&1
