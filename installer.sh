#!/bin/sh
# Prépare GoatHub sur un serveur : crée les secrets (.env) et la configuration du vocal (livekit.yaml).
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then
  echo "Le fichier .env existe déjà : rien n'a été modifié."
  exit 0
fi
printf "Nom de domaine du site (ex : goathub.exemple.fr) : "
read -r DOMAIN
printf "Ton e-mail (tu seras administrateur du site) : "
read -r ADMIN
rand() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
LK_KEY="API$(rand 12)"
LK_SECRET="$(rand 48)"
IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

umask 077
cat > .env <<EOT
# Secrets de GoatHub : ne jamais partager ce fichier.
# NE JAMAIS changer APP_SECRET : il chiffre les e-mails et les secrets de double authentification.
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(rand 32)
APP_SECRET=$(rand 48)
BACKUP_PASSPHRASE=$(rand 40)
LIVEKIT_API_KEY=$LK_KEY
LIVEKIT_API_SECRET=$LK_SECRET
ADMIN_EMAILS=$ADMIN
SIGNUP_CODE=
ALERT_WEBHOOK=
EOT

cat > livekit.yaml <<EOT
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: false
  node_ip: $IP
turn:
  enabled: true
  udp_port: 3478
keys:
  $LK_KEY: $LK_SECRET
webhook:
  api_key: $LK_KEY
  urls:
    - http://app:3000/api/livekit/webhook
logging:
  level: warn
EOT

mkdir -p backups
echo
echo "C'est prêt. Lance maintenant :  docker compose up -d --build"
echo "IMPORTANT : copie le fichier .env dans un endroit sûr (gestionnaire de mots de passe)."
