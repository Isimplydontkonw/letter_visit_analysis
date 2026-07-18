@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

title 噪声信访 WebGIS 本地服务

echo 正在启动噪声信访 WebGIS...
echo.

if not exist "python\webgis_api_server.py" (
  echo 未找到 python\webgis_api_server.py，请确认当前文件在项目根目录。
  echo.
  pause
  exit /b 1
)

rem 避免旧 C# 启动器继续占用 8020 端口。
taskkill /IM "启动WebGIS.exe" /F >nul 2>nul
taskkill /IM "WebGISLauncherDebug.exe" /F >nul 2>nul

set "PYTHON_CMD="
where python >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=python"

if not defined PYTHON_CMD (
  where py >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)

if not defined PYTHON_CMD (
  echo 未找到 Python。
  echo 请先安装 Python 3.10 或更高版本，并勾选 Add Python to PATH。
  echo.
  pause
  exit /b 1
)

%PYTHON_CMD% -c "import pandas, openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Python 依赖不完整，缺少 pandas 或 openpyxl。
  echo.
  set /p INSTALL_DEPS=是否现在自动安装依赖？输入 Y 后回车继续：
  if /I "%INSTALL_DEPS%"=="Y" (
    %PYTHON_CMD% -m pip install pandas openpyxl xlrd
    %PYTHON_CMD% -c "import pandas, openpyxl" >nul 2>nul
    if errorlevel 1 (
      echo 依赖安装失败，请检查网络或 Python/pip 环境。
      echo.
      pause
      exit /b 1
    )
  ) else (
    echo 已取消启动。
    echo.
    pause
    exit /b 1
  )
)

echo 本地服务启动后会自动打开网页。
echo 如需停止服务，请关闭本窗口或按 Ctrl+C。
echo.

%PYTHON_CMD% python\webgis_api_server.py

echo.
echo WebGIS 服务已停止。
pause
