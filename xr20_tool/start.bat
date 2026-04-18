@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ and re-run.
    echo         https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [INFO] Installing dependencies (pywinauto / pytesseract / mss / pillow)...
python -m pip install --quiet --disable-pip-version-check pywinauto pytesseract mss pillow

echo [INFO] Launching XR20 Monitor...
python "%~dp0xr20_monitor.py" %*
set RC=%ERRORLEVEL%

if not %RC%==0 (
    echo.
    echo [ERROR] Exit code %RC%
    pause
)
endlocal
exit /b %RC%
