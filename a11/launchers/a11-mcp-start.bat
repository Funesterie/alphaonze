@echo off
title A11 MCP - Lancer/Relancer

:: --- Backend (port 3000) ---
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

:: --- Frontend (port 5173) ---
echo [A11] Verification frontend port 5173...
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul 2>&1
if %errorlevel% == 0 (
    echo [A11] Frontend deja actif.
) else (
    echo [A11] Demarrage frontend...
    start "A11 Frontend" /MIN cmd /c "cd /d D:\projets\funesterie\a11\frontend\apps\web && npm run dev"
)

echo.
echo [A11] Services en cours de demarrage...
echo [A11] Backend  : http://localhost:3000
echo [A11] Frontend : http://localhost:5173
echo.
timeout /t 5 /nobreak >nul

:: Ouvrir le navigateur
start "" "http://localhost:5173"
