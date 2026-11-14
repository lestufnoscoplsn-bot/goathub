@echo off
rem Arrête GoatHub (les comptes et messages sont conservés).
cd /d "%~dp0"
docker compose -f docker-compose.local.yml --env-file .env.local stop
echo GoatHub est arrete.
pause
