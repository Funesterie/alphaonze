@echo off
cd /d "D:\projets\funesterie\a11\backend\apps\server"
pm2 start ecosystem.config.cjs
pm2 save
