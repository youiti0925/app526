@echo off
rem Stop the automatic patrol.
schtasks /Delete /TN "CWPatrol-Every3h" /F
schtasks /Delete /TN "CWPatrol-Logon" /F 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\cw-patrol.cmd" 2>nul
echo.
echo Stopped.
pause
