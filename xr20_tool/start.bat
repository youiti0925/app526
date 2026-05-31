@echo off
title XR20 Evaluation Tool - Setup and Launch

rem ====================================================================
rem Auto-elevate to administrator (needed for Python install)
rem ====================================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Re-launching as administrator. Click "Yes" on the UAC dialog...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

rem ====================================================================
rem Check winget availability
rem ====================================================================
where winget >nul 2>nul
if errorlevel 1 (
    set NOWINGET=1
    echo [WARN] winget not found. Manual install may be required:
    echo          Python : https://www.python.org/downloads/
    echo.
)

rem ====================================================================
rem [1/3] Python
rem ====================================================================
echo.
echo === [1/3] Python ===
where python >nul 2>nul
if errorlevel 1 (
    echo [..] Python is NOT installed. Starting installation...
    if not defined NOWINGET (
        winget install -e --id Python.Python.3.12 --scope machine --silent --accept-package-agreements --accept-source-agreements
        set "PATH=%PATH%;C:\Program Files\Python312;C:\Program Files\Python312\Scripts"
    )
) else (
    echo [OK] Python is already installed:
    python --version
)

where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo [INFO] Python was just installed. Please CLOSE this window and
    echo        double-click start.bat ONE MORE TIME to refresh PATH.
    echo.
    pause
    exit /b 0
)

rem ====================================================================
rem [2/3] Python dependencies
rem ====================================================================
echo.
echo === [2/3] Python packages ===
echo [..] Installing/updating required packages...
python -m pip install --quiet --disable-pip-version-check pywinauto pyautogui matplotlib pillow
echo [OK] Python packages ready.

rem ====================================================================
rem [3/3] Launch
rem ====================================================================
echo.
echo === [3/3] Launching XR20 Evaluation Tool ===
echo.
python "%~dp0xr20_eval.py" %*
set RC=%ERRORLEVEL%

if not %RC%==0 (
    echo.
    echo [ERROR] Exit code %RC%
    pause
)
exit /b %RC%
