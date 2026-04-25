@echo off
setlocal
set "ROOT=%~dp0"
set "CADDY=caddy"
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe\caddy.exe" set "CADDY=%LOCALAPPDATA%\Microsoft\WinGet\Packages\CaddyServer.Caddy_Microsoft.Winget.Source_8wekyb3d8bbwe\caddy.exe"
cd /d "%ROOT%"
"%CADDY%" run --config Caddyfile --adapter caddyfile
