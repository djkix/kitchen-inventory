#!/bin/sh
# Essai du script de sauvegarde, dans l'image : faux pg_dump et psql, cible, médias et stack factices dans /tmp.
# Usage : docker run --rm --user node --entrypoint sh <image> /app/backup/test.sh (lancé par la CI).
set -u
R=/tmp/essai-sauvegarde
rm -rf "$R"
mkdir -p "$R/bin" "$R/nas" "$R/media/products" "$R/stack"

cat > "$R/bin/pg_dump" <<'EOF'
#!/bin/sh
[ "${FAKE_PG_FAIL:-0}" = 1 ] && exit 1
echo "$*" > "${0%/bin/pg_dump}/pg_dump.args"
while [ $# -gt 0 ]; do
  if [ "$1" = -f ]; then echo dump > "$2"; exit 0; fi
  shift
done
exit 1
EOF
cat > "$R/bin/psql" <<EOF
#!/bin/sh
[ "\${FAKE_PSQL_FAIL:-0}" = 1 ] && exit 2
case "\$*" in *BackupRequest*) [ "\${FAKE_REQUEST:-0}" = 1 ] && echo 1; exit 0 ;; esac
echo "\$*" >> "$R/sql.log"
EOF
chmod +x "$R/bin/pg_dump" "$R/bin/psql"
echo compose > "$R/stack/compose.yaml"
echo env > "$R/stack/.env"
echo a > "$R/media/a.jpg"
echo p > "$R/media/products/p.jpg"

fail() { echo "ÉCHEC : $1" >&2; cat "$R/out.log" >&2; exit 1; }
night() {
  BACKUP_DAY="$1" BACKUP_TARGET="$R/nas" BACKUP_MEDIA="${MEDIA_TEST:-$R/media}" BACKUP_STACK="${STACK_TEST:-$R/stack}" \
    DATABASE_URL=postgresql://faux PATH="$R/bin:$PATH" /app/backup/backup.sh > "$R/out.log" 2>&1
}
inode() { stat -c %i "$1"; }
dates() { ls -d "$R/nas"/????-??-?? 2>/dev/null | sed 's|.*/||' | tr '\n' ' '; }

# première nuit
night 2026-10-01 || fail "première nuit : code $?"
for f in base/kitchen.dump media/a.jpg media/products/p.jpg config/compose.yaml config/.env sauvegarde.txt; do
  [ -f "$R/nas/2026-10-01/$f" ] || fail "première nuit : $f absent"
done
[ "$(readlink "$R/nas/derniere")" = 2026-10-01 ] || fail "première nuit : lien derniere"
grep -q "true, '', 5)" "$R/sql.log" || fail "première nuit : tentative ou taille non inscrite"
grep -q -- '--lock-wait-timeout=10min' "$R/pg_dump.args" || fail "pg_dump sans délai d'attente des verrous"

# fichier inchangé : lien physique
echo b > "$R/media/b.jpg"
night 2026-10-02 || fail "deuxième nuit : code $?"
[ "$(inode "$R/nas/2026-10-01/media/a.jpg")" = "$(inode "$R/nas/2026-10-02/media/a.jpg")" ] || fail "fichier inchangé : pas de lien physique"
[ -f "$R/nas/2026-10-02/media/b.jpg" ] && [ ! -e "$R/nas/2026-10-01/media/b.jpg" ] || fail "nouveau fichier"

# fichier disparu : absent du jour, présent la veille
rm "$R/media/a.jpg"
night 2026-10-03 || fail "troisième nuit : code $?"
[ ! -e "$R/nas/2026-10-03/media/a.jpg" ] && [ -f "$R/nas/2026-10-02/media/a.jpg" ] || fail "fichier disparu"

# même jour : remplacé
night 2026-10-03 || fail "même jour : code $?"
[ "$(dates)" = "2026-10-01 2026-10-02 2026-10-03 " ] || fail "même jour : $(dates)"
[ ! -e "$R/nas/.remplace" ] || fail "même jour : .remplace laissé"

# sept jours
for j in 04 05 06 07 08 09 10; do night "2026-10-$j" || fail "nuit du $j : code $?"; done
[ "$(dates)" = "2026-10-04 2026-10-05 2026-10-06 2026-10-07 2026-10-08 2026-10-09 2026-10-10 " ] || fail "sept jours : $(dates)"

# échec des médias : rien n'est supprimé
(MEDIA_TEST="$R/absent" night 2026-10-11) && fail "échec des médias : code 0"
[ "$(dates)" = "2026-10-04 2026-10-05 2026-10-06 2026-10-07 2026-10-08 2026-10-09 2026-10-10 " ] || fail "échec des médias : $(dates)"
[ "$(readlink "$R/nas/derniere")" = 2026-10-10 ] || fail "échec des médias : lien derniere"
tail -1 "$R/sql.log" | grep -q "false, 'étape medias (code [0-9]*)', NULL" || fail "échec des médias : non inscrit"

# échec de la base
(FAKE_PG_FAIL=1 night 2026-10-11) && fail "échec de la base : code 0"
tail -1 "$R/sql.log" | grep -q 'étape base' || fail "échec de la base : message"

# stack sans fichier compose : échec de la configuration
mkdir -p "$R/vide" && echo env > "$R/vide/.env"
(STACK_TEST="$R/vide" night 2026-10-11) && fail "sans compose : code 0"
tail -1 "$R/sql.log" | grep -q 'étape config' || fail "sans compose : message"

# reste d'une tentative interrompue
mkdir -p "$R/nas/.en-cours/vieux"
night 2026-10-11 || fail "après interruption : code $?"
[ ! -e "$R/nas/.en-cours" ] || fail "reste d'une tentative interrompue"
[ "$(dates)" = "2026-10-05 2026-10-06 2026-10-07 2026-10-08 2026-10-09 2026-10-10 2026-10-11 " ] || fail "après interruption : $(dates)"

# inscription impossible : code de sortie de la sauvegarde conservé
(FAKE_PSQL_FAIL=1 night 2026-10-12) || fail "inscription impossible : code $?"
[ -d "$R/nas/2026-10-12" ] || fail "inscription impossible : dossier absent"

# déjà en cours : une deuxième tentative s'arrête sans toucher à rien
lines="$(wc -l < "$R/sql.log")"
mkdir -p "$R/nas/.en-cours/temoin"
(
  exec 9> "$R/verrou"
  flock -n 9 || exit 3
  BACKUP_LOCK="$R/verrou" night 2026-10-13 && exit 1
  exit 0
) || fail "déjà en cours : la deuxième tentative a tourné"
grep -q 'déjà en cours' "$R/out.log" || fail "déjà en cours : message"
[ -d "$R/nas/.en-cours/temoin" ] || fail "déjà en cours : .en-cours supprimé"
[ ! -e "$R/nas/2026-10-13" ] || fail "déjà en cours : dossier créé"
[ "$(wc -l < "$R/sql.log")" = "$lines" ] || fail "déjà en cours : tentative inscrite"

# planification : une demande depuis Réglages lance une sauvegarde à toute heure ; sans demande, rien avant l'heure
printf '#!/bin/sh\necho fait >> "%s/fait"\n' "$R" > "$R/bin/fake-backup"
chmod +x "$R/bin/fake-backup"
schedule() {
  BACKUP_HOUR=24 BACKUP_TARGET="$R/nas" DATABASE_URL=postgresql://faux PATH="$R/bin:$PATH" BACKUP_SCRIPT="$R/bin/fake-backup" \
    timeout 2 /app/backup/schedule.sh > "$R/out.log" 2>&1
}
(FAKE_REQUEST=1 schedule)
[ "$(cat "$R/fait" 2>/dev/null)" = fait ] || fail "planification : demande non prise"
rm -f "$R/fait"
schedule
[ ! -e "$R/fait" ] || fail "planification : sauvegarde sans demande avant l'heure"

rm -rf "$R"
echo "Essai de la sauvegarde réussi."
