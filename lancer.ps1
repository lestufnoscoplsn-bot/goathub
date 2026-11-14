# Lance GoatHub sur cet ordinateur Windows, puis l'ouvre sur http://localhost:3000
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker n'est pas lancé." -ForegroundColor Red
  Write-Host "1. Installe Docker Desktop : https://www.docker.com/products/docker-desktop/"
  Write-Host "2. Ouvre Docker Desktop et attends qu'il affiche « Engine running »."
  Write-Host "3. Relance lancer.bat."
  exit 1
}

function Rand([int]$n) {
  $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] $n
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

if (-not (Test-Path .env.local)) {
  # Adresse de cet ordinateur sur le réseau (nécessaire pour que le son passe)
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|Docker' } |
    Select-Object -First 1).IPAddress
  if (-not $ip) { $ip = '127.0.0.1' }
  $secret = Rand 48
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText("$PSScriptRoot\.env.local", "POSTGRES_PASSWORD=$(Rand 24)`nAPP_SECRET=$(Rand 48)`nLIVEKIT_API_KEY=local`nLIVEKIT_API_SECRET=$secret`n", $utf8)
  $yaml = "port: 7880`nrtc:`n  tcp_port: 7881`n  port_range_start: 50000`n  port_range_end: 50100`n  use_external_ip: false`n  node_ip: $ip`nkeys:`n  local: $secret`nwebhook:`n  api_key: local`n  urls: [http://app:3000/api/livekit/webhook]`nlogging:`n  level: warn`n"
  [IO.File]::WriteAllText("$PSScriptRoot\livekit.local.yaml", $yaml, $utf8)
}

Write-Host "Démarrage de GoatHub (la première fois, ça prend quelques minutes)..." -ForegroundColor Cyan
docker compose -f docker-compose.local.yml --env-file .env.local up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host "Le démarrage a échoué : envoie une capture de cette fenêtre." -ForegroundColor Red; exit 1 }

Write-Host "Attente du démarrage" -NoNewline
for ($i = 0; $i -lt 120; $i++) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri http://localhost:3000/healthz -TimeoutSec 2 | Out-Null
    Write-Host ""
    Write-Host "GoatHub est prêt : http://localhost:3000" -ForegroundColor Green
    Start-Process "http://localhost:3000"
    Write-Host "Pour l'arrêter : double-clique sur arreter.bat"
    exit 0
  } catch { Write-Host "." -NoNewline; Start-Sleep 2 }
}
Write-Host ""
Write-Host "GoatHub ne répond pas. Envoie une capture de cette fenêtre." -ForegroundColor Red
exit 1
