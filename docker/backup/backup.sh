#!/bin/sh
# Une sauvegarde vers le NAS (section 9) : base, puis médias, puis configuration de la stack, dans un dossier daté.
# Sept jours gardés ; un média inchangé est un lien physique vers celui de la veille. Sans chiffrement.
# Une tentative ratée ne supprime rien. Chaque tentative est inscrite dans la table BackupAttempt, lue par
# Réglages › Sauvegarde.
# Usage : /app/backup/backup.sh (lancé chaque nuit par schedule.sh, ou à la main). Sort en 0 si tout a réussi.
set -u
TARGET="${BACKUP_TARGET:-/nas}"
MEDIA="${BACKUP_MEDIA:-/data/media}"
STACK="${BACKUP_STACK:-/stack}"
KEEP="${BACKUP_KEEP:-7}"
: "${DATABASE_URL:?DATABASE_URL manquante}"
DAY="${BACKUP_DAY:-$(date +%F)}"
START="$(date +%s)"
START_ISO="$(date -Iseconds)"
TMP="$TARGET/.en-cours"
MESSAGE=""
DUMP_BYTES=NULL
umask 022

# Une seule sauvegarde à la fois (planifiée et à la main partagent le /tmp du conteneur) ; rien n'est inscrit.
exec 9> "${BACKUP_LOCK:-/tmp/sauvegarde.verrou}"
flock -n 9 || { echo "Sauvegarde déjà en cours : rien n'est fait." >&2; exit 1; }

# Message technique seulement : jamais de contenu de l'inventaire.
fail() { MESSAGE="étape $1 (code $2)"; return 1; }

run() {
  rm -rf "$TMP" && mkdir -p "$TMP/base" "$TMP/config" || fail base $? || return
  # La base d'abord : toute photo qu'elle référence sera dans les médias copiés ensuite.
  # Une table verrouillée ne bloque pas la nuit : pg_dump abandonne au bout de 10 minutes.
  pg_dump -Fc --lock-wait-timeout=10min --dbname="$DATABASE_URL" -f "$TMP/base/kitchen.dump" || fail base $? || return
  # Sans propriétaire ni groupe : le NAS les écrase (squash) ; la restauration remet node (1000).
  set -- -rlt
  [ -d "$TARGET/derniere/media" ] && set -- "$@" --link-dest="$TARGET/derniere/media"
  rsync "$@" "$MEDIA/" "$TMP/media/" || fail medias $? || return
  # Le fichier compose porte le nom que lui a donné le déploiement (compose.yaml sous Dockge).
  found=""
  for f in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
    if [ -f "$STACK/$f" ]; then cp "$STACK/$f" "$TMP/config/" || fail config $? || return; found=1; fi
  done
  [ -n "$found" ] || fail config 1 || return
  cp "$STACK/.env" "$TMP/config/" || fail config $? || return
  {
    echo "version : ${APP_VERSION:-inconnue}"
    echo "début : $START_ISO"
    echo "fin : $(date -Iseconds)"
    echo "base : $(($(wc -c < "$TMP/base/kitchen.dump"))) octets"
    echo "fichiers médias : $(($(find "$TMP/media" -type f | wc -l)))"
  } > "$TMP/sauvegarde.txt" || fail config 1 || return
  # Une deuxième sauvegarde le même jour remplace celle du jour.
  if [ -e "$TARGET/$DAY" ]; then
    rm -rf "$TARGET/.remplace" && mv "$TARGET/$DAY" "$TARGET/.remplace" || fail rotation $? || return
  fi
  mv "$TMP" "$TARGET/$DAY" || fail rotation $? || return
  rm -rf "$TARGET/.remplace"
  # Lien relatif : lisible depuis l'explorateur du NAS comme depuis le conteneur.
  ln -sfn "$DAY" "$TARGET/derniere" || fail rotation $? || return
  ls -d "$TARGET"/????-??-?? | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -rf "$old"
  done
}

if run; then
  SUCCEEDED=true
  DUMP_BYTES="$(($(wc -c < "$TARGET/$DAY/base/kitchen.dump")))"
  echo "Sauvegarde du $DAY réussie."
else
  SUCCEEDED=false
  echo "Sauvegarde en échec : $MESSAGE." >&2
fi
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "INSERT INTO \"BackupAttempt\" (\"startedAt\", \"finishedAt\", \"succeeded\", \"message\", \"dumpBytes\") \
VALUES (to_timestamp($START) AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC', $SUCCEEDED, '$MESSAGE', $DUMP_BYTES)" > /dev/null \
  || echo "Inscription de la sauvegarde impossible : Réglages le signalera si rien ne réussit en 36 h." >&2
[ "$SUCCEEDED" = true ]
