@echo off
chcp 65001 >nul
title 期效管家 LifeSpan Tracker 啟動器
echo ====================================================
echo 正在啟動「期效管家 (LifeSpan Tracker)」...
echo ====================================================

:: 檢查 python 是否存在，若存在則啟動本機伺服器，若無則直接以預設瀏覽器開啟 index.html
where python >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] 檢測到本機 Python 環境，正在啟動專屬 Web 伺服器 (連接埠 8080)...
    start "" http://localhost:8080/
    python -m http.server 8080
) else (
    echo [OK] 正在直接以預設瀏覽器開啟應用程式...
    start "" "%~dp0index.html"
)
pause
