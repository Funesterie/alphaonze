@echo off
rem Wrapper to run qflush CLI from repository root using local dist build
set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%dist\index.js" %*
