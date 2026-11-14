#!/bin/sh
# Sauvegarde chiffrée (AES-256) de la base PostgreSQL et des fichiers envoyés, chaque nuit.
# Les sauvegardes de plus de 14 jours sont effacées.
#
# Pour restaurer une sauvegarde de la base (voir LISEZMOI.md) :
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in FICHIER.sql.gz.enc | gunzip | psql ...
while true; do
  stamp=$(date +%Y%m%d-%H%M)
  base="/backups/goathub-$stamp.sql.gz.enc"
  if pg_dump -h postgres -U goathub goathub | gzip | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$base"; then
    chmod 600 "$base"
    echo "Sauvegarde de la base : $base"
  else
    echo "ÉCHEC de la sauvegarde de la base" >&2
  fi
  files="/backups/fichiers-$stamp.tar.gz.enc"
  if [ -d /appdata/uploads ]; then
    tar czf - -C /appdata uploads | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$files" && chmod 600 "$files"
  fi
  # Ménage : uniquement les fichiers de sauvegarde de ce dossier, plus vieux que 14 jours
  find /backups -maxdepth 1 -type f -name '*.enc' -mtime +14 -exec rm -f {} \;
  sleep 86400
done
