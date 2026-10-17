@echo off
rem Run the patrol automatically: 5 minutes after logon, and every 3 hours while the PC is on.
rem To stop: run cw-patrol-unregister.cmd
set RUNNER="%~dp0cw-patrol-run.cmd"
schtasks /Create /F /TN "CWPatrol-Logon" /SC ONLOGON /DELAY 0005:00 /TR %RUNNER%
schtasks /Create /F /TN "CWPatrol-Every3h" /SC HOURLY /MO 3 /TR %RUNNER%
echo.
echo Registered. To stop, run cw-patrol-unregister.cmd
pause
