@echo off
setlocal
title A11 - Ecoute backend
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0a11-monitor-backend.ps1" %*
pause
