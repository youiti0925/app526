@echo off
chcp 65001 > nul
title IK220 自動監視ツール セットアップ／起動

rem ====================================================================
rem 管理者権限へ自動昇格（Python/Tesseractのインストールに必要）
rem ====================================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] 管理者権限で再起動します。UACダイアログで「はい」を押してください...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"

rem ====================================================================
rem winget の有無を確認
rem ====================================================================
where winget >nul 2>nul
if errorlevel 1 (
    set NOWINGET=1
    echo [WARN] winget が見つかりません（Windows 10 1809未満など）。
    echo        手動インストールが必要です:
    echo          Python : https://www.python.org/downloads/
    echo          Tesseract: https://github.com/UB-Mannheim/tesseract/wiki ^(Japanese を選択^)
    echo.
)

rem ====================================================================
rem Python
rem ====================================================================
where python >nul 2>nul
if errorlevel 1 (
    if not defined NOWINGET (
        echo [INFO] Python をインストールします...
        winget install -e --id Python.Python.3.12 --scope machine --silent --accept-package-agreements --accept-source-agreements
        set "PATH=%PATH%;C:\Program Files\Python312;C:\Program Files\Python312\Scripts"
    )
)

where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo [INFO] Python を新規インストールしました。PATH を反映させるため
    echo        この start.bat を一度閉じて、もう一度ダブルクリックしてください。
    echo.
    pause
    exit /b 0
)

rem ====================================================================
rem Tesseract OCR
rem ====================================================================
where tesseract >nul 2>nul
if errorlevel 1 (
    if not defined NOWINGET (
        echo [INFO] Tesseract OCR をインストールします...
        winget install -e --id UB-Mannheim.TesseractOCR --silent --accept-package-agreements --accept-source-agreements
    )
)
set "PATH=%PATH%;C:\Program Files\Tesseract-OCR"

rem ====================================================================
rem 日本語OCRデータ（コメント欄の「精度不良」読み取りに必須）
rem ====================================================================
set "TESSDATA=C:\Program Files\Tesseract-OCR\tessdata"
if exist "%TESSDATA%" (
    if not exist "%TESSDATA%\jpn.traineddata" (
        echo [INFO] 日本語OCRデータをダウンロードします...
        curl -L -o "%TESSDATA%\jpn.traineddata" https://github.com/tesseract-ocr/tessdata/raw/main/jpn.traineddata
    )
)

rem ====================================================================
rem Python 依存パッケージ
rem ====================================================================
echo [INFO] Python 依存パッケージを導入中...
python -m pip install --quiet --disable-pip-version-check pywinauto pytesseract mss pillow

where tesseract >nul 2>nul
if errorlevel 1 (
    echo [WARN] Tesseract がまだ見つかりません。OCR（傾値・コメント読み取り）が
    echo        失敗する場合は PC を再起動してから再実行してください。
    echo.
)

echo [INFO] IK220 自動監視ツールを起動します...
python "%~dp0xr20_monitor.py" %*
set RC=%ERRORLEVEL%

if not %RC%==0 (
    echo.
    echo [ERROR] 終了コード %RC%
    pause
)
exit /b %RC%
