@echo off
rem Double-clique sur ce fichier pour lancer GoatHub sur ton ordinateur.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lancer.ps1"
pause
