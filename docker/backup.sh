#!/bin/sh
# Sauvegarde périodique (section 9) : dump PostgreSQL compressé et archive du
# dossier média, avec rotation. Exécuté en boucle par le service « backup ».
# Les variables PG* viennent de l'environnement du conteneur.
#
# Restauration à blanc à tester avant la mise en service :
#   gunzip -c backups/db-<date>.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" -d <base_de_test>
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MEDIA_DIR="${MEDIA_DIR:-/media}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

backup() {
  stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  db_target="${BACKUP_DIR}/db-${stamp}.sql.gz"
  media_target="${BACKUP_DIR}/media-${stamp}.tar.gz"

  log "Dump de la base vers $(basename "$db_target")"
  # Écriture sous un nom temporaire puis renommage : une sauvegarde interrompue
  # ne laisse jamais un fichier d'apparence valide.
  if pg_dump --no-owner --no-privileges | gzip -9 > "${db_target}.partial"; then
    mv "${db_target}.partial" "$db_target"
    log "Base : $(du -h "$db_target" | cut -f1)"
  else
    rm -f "${db_target}.partial"
    log "ÉCHEC du dump de la base"
    return 1
  fi

  if [ -d "$MEDIA_DIR" ]; then
    log "Archive des médias vers $(basename "$media_target")"
    if tar czf "${media_target}.partial" -C "$MEDIA_DIR" .; then
      mv "${media_target}.partial" "$media_target"
      log "Médias : $(du -h "$media_target" | cut -f1)"
    else
      rm -f "${media_target}.partial"
      log "ÉCHEC de l'archive des médias"
    fi
  fi
}

purge() {
  removed="$(find "$BACKUP_DIR" \( -name 'db-*.sql.gz' -o -name 'media-*.tar.gz' \) -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
  [ "$removed" -gt 0 ] && log "Purge : ${removed} fichier(s) de plus de ${RETENTION_DAYS} jours"
  return 0
}

log "Service de sauvegarde démarré (intervalle ${INTERVAL} s, rétention ${RETENTION_DAYS} jours)"
while true; do
  backup || log "Nouvelle tentative au prochain cycle"
  purge || true
  sleep "$INTERVAL"
done
