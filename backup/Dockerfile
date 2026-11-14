# Image de sauvegarde : outils PostgreSQL + openssl (déjà inclus dans cette image)
FROM postgres:16
COPY sauvegarde.sh /sauvegarde.sh
CMD ["/bin/sh", "/sauvegarde.sh"]
