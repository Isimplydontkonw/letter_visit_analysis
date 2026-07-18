@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title WebGIS Local Server

echo Starting WebGIS local server...
echo.

if not exist "python\webgis_api_server.py" (
  echo Missing python\webgis_api_server.py. Please keep this BAT file in the project root.
  echo.
  pause
  exit /b 1
)

rem Stop old launchers if they are still running.
taskkill /IM "WebGISLauncherDebug.exe" /F >nul 2>nul

set "PYTHON_CMD="
if exist "runtime\python\python.exe" set "PYTHON_CMD=runtime\python\python.exe"

if not defined PYTHON_CMD (
  where python >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  where py >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)

if not defined PYTHON_CMD (
  echo Python was not found.
  echo Please run tools\setup_portable_python.ps1 or install Python 3.10 or newer.
  echo.
  pause
  exit /b 1
)

%PYTHON_CMD% -c "import pandas, openpyxl" >nul 2>nul
if errorlevel 1 (
  echo Missing Python packages: pandas or openpyxl.
  echo.
  set /p INSTALL_DEPS=Install them now? Type Y and press Enter: 
  if /I "%INSTALL_DEPS%"=="Y" (
    %PYTHON_CMD% -m pip install pandas openpyxl xlrd
    %PYTHON_CMD% -c "import pandas, openpyxl" >nul 2>nul
    if errorlevel 1 (
      echo Dependency installation failed. Please run tools\setup_portable_python.ps1 or check network access.
      echo.
      pause
      exit /b 1
    )
  ) else (
    echo Start cancelled.
    echo.
    pause
    exit /b 1
  )
)

echo Local server will open the browser automatically.
echo If the browser does not open, copy the URL shown below.
echo Keep this window open while using WebGIS.
echo.

%PYTHON_CMD% python\webgis_api_server.py

echo.
echo WebGIS server stopped.
pause

