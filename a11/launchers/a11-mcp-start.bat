@echo off
title A11 MCP - Lancer/Relancer

:: --- Backend local (port 3000) ---
echo [A11] Verification backend port 3000...
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo [A11] Backend deja actif - relancement...
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
        taskkill /PID %%p /F >nul 2>&1
    )
    timeout /t 2 /nobreak >nul
)

echo [A11] Demarrage backend...
start "A11 Backend" /MIN cmd /c "cd /d D:\projets\funesterie\a11\backend\apps\server && node server.cjs"

timeout /t 3 /nobreak >nul

:: Ouvrir le frontend Netlify
start "" "https://alphaonze.funesterie.pro"

echo [A11] Backend local : http://localhost:3000
echo [A11] Frontend      : https://alphaonze.funesterie.pro
timeout /t 2 /nobreak >nul
