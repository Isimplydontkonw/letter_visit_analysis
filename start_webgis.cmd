@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_EXE=C:\Users\20544\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "PYTHON_EXE=C:\Users\20544\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "WEBGIS_PORT=8020"

cd /d "%ROOT%"
start "WebGIS" "%NODE_EXE%" "%ROOT%webgis_node_server.mjs"
endlocal
