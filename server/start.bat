@echo off
setlocal
title Canvas Gateway

set "NODE_HOME=C:\Users\Admin\.workbuddy\binaries\node\versions"
set "NODE_EXE=%NODE_HOME%\22.22.2-6\node.exe"
if exist "%NODE_EXE%" goto :node_ready
for /f "delims=" %%i in ('type "%NODE_HOME%\current" 2^>nul') do set "NODE_EXE=%NODE_HOME%\%%i\node.exe"
if exist "%NODE_EXE%" goto :node_ready
for /f "delims=" %%i in ('where node 2^>nul') do (
  set "NODE_EXE=%%i"
  goto :node_ready
)
:node_ready

cd /d "%~dp0"

if not exist ".env.local" (
  echo Missing server\.env.local
  echo Copy server\.env.example to server\.env.local and fill in UPSTREAM_BASE / UPSTREAM_KEY.
  pause
  exit /b 1
)

"%NODE_EXE%" gateway.mjs
pause
