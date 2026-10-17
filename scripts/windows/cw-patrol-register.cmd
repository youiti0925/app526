@echo off
rem Register the automatic patrol (no admin rights needed).
schtasks /Create /F /TN "CWPatrol-Every3h" /SC HOURLY /MO 3 /TR "%~dp0cw-patrol-run.cmd"
(echo @echo off& echo timeout /t 300 /nobreak ^>nul& echo call "%~dp0cw-patrol-run.cmd") > "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\cw-patrol.cmd"
echo.
echo Registered. To stop, run cw-patrol-unregister.cmd
pause
