@echo off
cd /d "D:\projets\funesterie\a11\backend\apps\server"
"C:\Users\cella\AppData\Roaming\npm\pm2.cmd" start ecosystem.config.cjs
"C:\Users\cella\AppData\Roaming\npm\pm2.cmd" save
pause
