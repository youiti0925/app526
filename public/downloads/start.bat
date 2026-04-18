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

echo [INFO] Installing Python dependencies...
python -m pip install --quiet --disable-pip-version-check pywinauto pytesseract mss pillow

where tesseract >nul 2>nul
if errorlevel 1 (
    echo [WARN] Tesseract OCR is not in PATH.
    echo        Install from: https://github.com/UB-Mannheim/tesseract/wiki
    echo        Then add install dir (e.g. C:\Program Files\Tesseract-OCR) to PATH.
    echo        The tool will run, but tilt-value OCR will fail until Tesseract is available.
    echo.
)

echo [INFO] Launching IK220 Monitor (GUI mode)...
python "%~dp0xr20_monitor.py" %*
set RC=%ERRORLEVEL%

if not %RC%==0 (
    echo.
    echo [ERROR] Exit code %RC%
    pause
)
endlocal
exit /b %RC%
