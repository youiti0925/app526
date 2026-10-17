@echo off
rem Stop the automatic patrol.
schtasks /Delete /TN "CWPatrol-Logon" /F
schtasks /Delete /TN "CWPatrol-Every3h" /F
echo.
echo Stopped.
pause
