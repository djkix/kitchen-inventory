#!/bin/sh
# Planification de la sauvegarde : chaque jour dès BACKUP_HOUR (heure de TZ, défaut 3 h).
# Une nuit manquée (hôte ou NAS éteint) est rattrapée dès que le service tourne ; après un échec, une heure d'attente.
# Une sauvegarde demandée depuis Réglages (table BackupRequest) part au passage suivant, à toute heure.
set -u
HOUR="${BACKUP_HOUR:-3}"
TARGET="${BACKUP_TARGET:-/nas}"
BACKUP="${BACKUP_SCRIPT:-/app/backup/backup.sh}"
echo "Sauvegarde planifiée chaque jour à $HOUR h."
while :; do
  # La demande est effacée avant la sauvegarde : un échec est inscrit et signalé, sans boucle de reprise.
  if [ -n "$(psql "$DATABASE_URL" -tAq -c 'DELETE FROM "BackupRequest" RETURNING 1' 2>/dev/null)" ]; then
    echo "Sauvegarde demandée depuis Réglages."
    "$BACKUP"
  fi
  hour="$(date +%H | sed 's/^0//')"
  if [ "${hour:-0}" -ge "$HOUR" ] && [ "$(readlink "$TARGET/derniere" 2>/dev/null)" != "$(date +%F)" ]; then
    "$BACKUP" || sleep 3600
  fi
  sleep 300
done
