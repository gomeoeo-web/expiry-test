@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 期效管家 1.9.5
where node >nul 2>&1
if errorlevel 1 (
  echo 找不到 Node.js，請先安裝 Node.js 再啟動。
  pause
  exit /b 1
)
node scripts\serve.mjs
pause
