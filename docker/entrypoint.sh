#!/bin/sh
set -e

# Migrations Prisma jouées avant le démarrage du serveur (section 20). Si une
# migration échoue, le conteneur ne démarre pas sur un schéma partiel : chaque
# migration s'applique dans une transaction, la base reste dans l'état
# précédent. On temporise avant de sortir pour que Docker ne relance pas le
# conteneur en boucle à la seconde, ce qui empilerait des demandes de verrou et
# gênerait toute intervention manuelle.
DELAY="${MIGRATION_FAILURE_DELAY_SECONDS:-30}"

case "$1" in
  node)
    echo "Migrations Prisma : vérification…"
    if ! npx prisma migrate deploy --schema /app/prisma/schema.prisma; then
      echo "" >&2
      echo "=== ÉCHEC DE LA MIGRATION ===" >&2
      echo "L'application ne démarrera pas. La base n'a pas été modifiée au-delà" >&2
      echo "des migrations déjà appliquées. Pour diagnostiquer :" >&2
      echo "  docker compose logs app" >&2
      echo "  docker compose run --rm app npx prisma migrate status --schema /app/prisma/schema.prisma" >&2
      echo "Nouvelle tentative dans ${DELAY} s." >&2
      sleep "$DELAY"
      exit 1
    fi
    ;;
esac

exec "$@"
