@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0start-cloudflare-tunnel.ps1" %*
