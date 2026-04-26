@echo off
REM Script batch pour lancer l'installation Neo4j Desktop avec élévation
REM Double-cliquez sur ce fichier pour installer Neo4j Desktop

echo.
echo ========================================
echo Installation Neo4j Desktop pour A11
echo ========================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-neo4j-desktop-admin.ps1"

pause
