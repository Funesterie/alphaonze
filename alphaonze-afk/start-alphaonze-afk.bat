@echo off
setlocal
set "ROOT=%~dp0"
if "%ALPHAONZE_PORT%"=="" set "ALPHAONZE_PORT=8088"
if "%ALPHAONZE_HOST%"=="" set "ALPHAONZE_HOST=0.0.0.0"
set "NODE=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE=C:\Program Files\nodejs\node.exe"
cd /d "%ROOT%"
"%NODE%" server.cjs
