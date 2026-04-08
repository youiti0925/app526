@echo off

echo ========================================
echo  IK220 Monitor Build
echo ========================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found.
    pause
    exit /b 1
)

echo [1/3] Installing libraries...
pip install pyinstaller pywinauto requests

echo [2/3] Building exe...
pyinstaller --onefile --windowed --name "IK220_Monitor" --icon=NONE --hidden-import=pywinauto --hidden-import=pywinauto.controls --hidden-import=pywinauto.controls.uiawrapper --hidden-import=requests xr20_monitor.py

if errorlevel 1 (
    echo.
    echo ERROR: Build failed.
    pause
    exit /b 1
)

echo [3/3] Copying config...
if exist monitor_config.json copy monitor_config.json dist\monitor_config.json >nul

echo.
echo ========================================
echo  BUILD OK!
echo ========================================
echo.
echo Files:
echo   dist\IK220_Monitor.exe
echo   dist\monitor_config.json
echo.
echo Copy these 2 files to target PC.
echo.
pause
