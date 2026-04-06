@echo off
chcp 65001 >nul
echo ========================================
echo  IK220 自動監視ツール ビルドスクリプト
echo ========================================
echo.

REM Python確認
python --version >nul 2>&1
if errorlevel 1 (
    echo エラー: Python が見つかりません。
    echo https://www.python.org/downloads/ からインストールしてください。
    pause
    exit /b 1
)

echo [1/3] 必要なライブラリをインストール中...
pip install pyinstaller pywinauto requests >nul 2>&1
if errorlevel 1 (
    echo 警告: 一部のライブラリのインストールに失敗しました。
)

echo [2/3] exe をビルド中...
pyinstaller --onefile --windowed --name "IK220_Monitor" --icon=NONE ^
    --add-data "monitor_config.json;." ^
    --hidden-import=pywinauto ^
    --hidden-import=pywinauto.controls ^
    --hidden-import=pywinauto.controls.uiawrapper ^
    --hidden-import=requests ^
    xr20_monitor.py

if errorlevel 1 (
    echo.
    echo エラー: ビルドに失敗しました。
    pause
    exit /b 1
)

echo [3/3] 配布用フォルダを準備中...
if not exist dist\config mkdir dist\config >nul 2>&1

REM 設定ファイルをコピー
if exist monitor_config.json (
    copy monitor_config.json dist\monitor_config.json >nul
) else (
    echo { > dist\monitor_config.json
    echo   "switchbot_token": "", >> dist\monitor_config.json
    echo   "switchbot_secret": "", >> dist\monitor_config.json
    echo   "switchbot_device_id": "", >> dist\monitor_config.json
    echo   "app_title": "IK220分割測定KWIN10", >> dist\monitor_config.json
    echo   "capture_button": "取込開始", >> dist\monitor_config.json
    echo   "threshold_hr": 4, >> dist\monitor_config.json
    echo   "threshold_wr": 7, >> dist\monitor_config.json
    echo   "target_rows": ["HR", "WR", "WL", "HL"], >> dist\monitor_config.json
    echo   "dry_run": true, >> dist\monitor_config.json
    echo   "poll_interval_sec": 10 >> dist\monitor_config.json
    echo } >> dist\monitor_config.json
)

echo.
echo ========================================
echo  ビルド完了！
echo ========================================
echo.
echo 配布ファイル:
echo   dist\IK220_Monitor.exe    ... 実行ファイル
echo   dist\monitor_config.json  ... 設定ファイル
echo.
echo この2つのファイルを対象PCにコピーしてください。
echo monitor_config.json を編集してから IK220_Monitor.exe を実行します。
echo.
pause
