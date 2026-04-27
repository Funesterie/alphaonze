@echo off
:: ============================================================
:: A11 Dual Backend Launcher
:: Lance 2 instances du backend A11 sur des ports différents
:: Backend 1 : port 3000 (principal, A11 répond en priorité)
:: Backend 2 : port 3001 (Cerbère fallback)
:: ============================================================

setlocal

set "BACKEND_DIR=%~dp0..\backend\apps\server"
set "NODE=node"

:: Vérifier que node est disponible
where node >nul 2>&1
if errorlevel 1 (
    echo [ERR] Node.js introuvable dans le PATH
    pause
    exit /b 1
)

echo [A11] Demarrage du Backend 1 sur port 3000 (A11 principal)...
start "A11-Backend-3000" /min cmd /c "cd /d "%BACKEND_DIR%" && set PORT=3000 && set A11_INSTANCE=primary && node server.cjs 2>&1 | tee logs\backend-3000.log"

:: Attendre 2 secondes avant de lancer le second
timeout /t 2 /nobreak >nul

echo [A11] Demarrage du Backend 2 sur port 3001 (Cerbere fallback)...
start "A11-Backend-3001" /min cmd /c "cd /d "%BACKEND_DIR%" && set PORT=3001 && set A11_INSTANCE=cerbere-fallback && set MANAGE_CERBERE=true && node server.cjs 2>&1 | tee logs\backend-3001.log"

echo.
echo [A11] Les 2 backends sont en cours de demarrage :
echo   - Backend principal : http://127.0.0.1:3000
echo   - Backend Cerbere   : http://127.0.0.1:3001
echo.
echo Appuyez sur une touche pour fermer ce lanceur (les backends continuent)
pause >nul
