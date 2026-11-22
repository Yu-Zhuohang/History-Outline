@echo off
title 考研政治史纲时间线 - 本地预览
cd /d "%~dp0"

set "PORT=8000"
set "NOOPEN="
if /i "%~1"=="--no-open" set "NOOPEN=1"

rem ---------- 找一个可用的 Python ----------
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py"

if not defined PY goto :nopython

echo.
echo   项目目录：%CD%
echo   访问地址：http://localhost:%PORT%/
echo.
echo   关闭这个窗口即停止服务器；若浏览器没自动打开，手动访问上面的地址。
echo.

if defined NOOPEN goto :run
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PORT%/'"

:run
%PY% -m http.server %PORT%

echo.
echo   服务器已停止。
pause
exit /b 0

:nopython
echo.
echo   [x] 没有找到 Python。
echo.
echo   任选一种解决办法：
echo     1. 安装 Python：https://www.python.org/downloads/
echo        安装时务必勾选 "Add python.exe to PATH"
echo     2. 已装 Node.js：在本目录执行  npx serve .
echo     3. VS Code 安装 Live Server 插件，右键 index.html - Open with Live Server
echo.
pause
exit /b 1
