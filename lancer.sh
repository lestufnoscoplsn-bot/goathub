#!/bin/sh
# Lance GoatHub sur cet ordinateur (Mac ou Linux), puis l'ouvre sur http://localhost:3000
set -e
cd "$(dirname "$0")"
if ! docker info >/dev/null 2>&1; then
  echo "Docker n'est pas lancé. Installe Docker Desktop (https://www.docker.com/products/docker-desktop/), ouvre-le, puis relance ce fichier."
  exit 1
fi
rand() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
if [ ! -f .env.local ]; then
  # Adresse de cet ordinateur sur le réseau (nécessaire pour que le son passe)
  IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "$IP" ] || IP=127.0.0.1
  SECRET=$(rand 48)
  umask 077
  cat > .env.local <<EOT
POSTGRES_PASSWORD=$(rand 24)
APP_SECRET=$(rand 48)
LIVEKIT_API_KEY=local
LIVEKIT_API_SECRET=$SECRET
EOT
  cat > livekit.local.yaml <<EOT
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: false
  node_ip: $IP
keys:
  local: $SECRET
webhook:
  api_key: local
  urls: [http://app:3000/api/livekit/webhook]
logging:
  level: warn
EOT
fi
echo "Démarrage de GoatHub (la première fois, ça prend quelques minutes)…"
docker compose -f docker-compose.local.yml --env-file .env.local up -d --build
printf "Attente du démarrage"
i=0
until curl -fsS http://localhost:3000/healthz >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 120 ] && { echo; echo "GoatHub ne répond pas. Regarde : docker compose -f docker-compose.local.yml logs app"; exit 1; }
  printf "."; sleep 2
done
echo
echo "GoatHub est prêt : http://localhost:3000"
(open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1 || true
