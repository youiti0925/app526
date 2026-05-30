@echo off
title IK220 Monitor - Setup and Launch

rem ====================================================================
rem Auto-elevate to administrator (needed for Python/Tesseract install)
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
    echo          Python    : https://www.python.org/downloads/
    echo          Tesseract : https://github.com/UB-Mannheim/tesseract/wiki
    echo.
)

rem ====================================================================
rem Python
rem ====================================================================
echo.
echo === [1/4] Python ===
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
rem Tesseract OCR
rem ====================================================================
echo.
echo === [2/4] Tesseract OCR ===
where tesseract >nul 2>nul
if errorlevel 1 (
    echo [..] Tesseract is NOT installed. Starting installation...
    if not defined NOWINGET (
        winget install -e --id UB-Mannheim.TesseractOCR --silent --accept-package-agreements --accept-source-agreements
    )
) else (
    echo [OK] Tesseract is already installed.
)
set "PATH=%PATH%;C:\Program Files\Tesseract-OCR"

rem ====================================================================
rem Japanese OCR data (needed for comment-field "precision NG" reading)
rem ====================================================================
echo.
echo === [3/4] Japanese OCR data ===
set "TESSDATA=C:\Program Files\Tesseract-OCR\tessdata"
if exist "%TESSDATA%" (
    if not exist "%TESSDATA%\jpn.traineddata" (
        echo [..] Japanese OCR data is NOT present. Downloading...
        curl -L -o "%TESSDATA%\jpn.traineddata" https://github.com/tesseract-ocr/tessdata/raw/main/jpn.traineddata
    ) else (
        echo [OK] Japanese OCR data is already present.
    )
) else (
    echo [WARN] tessdata folder not found yet. It will be ready after reboot.
)

rem ====================================================================
rem Python dependencies
rem ====================================================================
echo.
echo === [4/4] Python packages ===
echo [..] Installing/updating pywinauto pytesseract mss pillow...
python -m pip install --quiet --disable-pip-version-check pywinauto pytesseract mss pillow bleak opencv-python numpy pystray
echo [OK] Python packages ready.

where tesseract >nul 2>nul
if errorlevel 1 (
    echo [WARN] Tesseract still not found. If OCR fails, reboot the PC and re-run.
    echo.
)

echo.
echo [INFO] Launching IK220 Monitor...
python "%~dp0xr20_monitor.py" %*
set RC=%ERRORLEVEL%

if not %RC%==0 (
    echo.
    echo [ERROR] Exit code %RC%
    pause
)
exit /b %RC%
