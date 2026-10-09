@echo off
rem Duel Channel - one-step hosting on Windows: dependencies, asset check, build when needed, server.
rem Arguments go to tools\host.mjs, e.g.  start.cmd --lan   (see docs/DEPLOY.md)
setlocal
for /f "tokens=2 delims=:." %%a in ('chcp') do set "_cp=%%a"
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请先安装 Node.js 22 或更新的版本：https://nodejs.org/
  echo 安装后重新双击 start.cmd。
  chcp %_cp% >nul
  pause
  exit /b 1
)
node tools\host.mjs %*
set "_rc=%errorlevel%"
chcp %_cp% >nul
if not "%_rc%"=="0" pause
exit /b %_rc%
