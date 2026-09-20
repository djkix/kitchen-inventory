# Choix d'implémentation du lot 1

2026-09-20 · Franck, avec assistance de Claude

Le cahier des charges (`docs/cahier-des-charges.md`) fait autorité. Ce
document consigne uniquement les choix qu'il laisse au jugement et la façon
dont le dépôt est livré « comme magazine-search » : dépôt GitHub public sous
`djkix`, intégration continue, images publiées sur GitHub Container Registry,
versions gérées par release-please.

Périmètre de la session de départ : lot 1 complet (inventaire), lot 2 exclu
conformément à la décision 8. La décision 1 (Grocy) est traitée comme tranchée
en faveur du développement complet : `CLAUDE.md` indique l'étape 0 validée et
l'étape 1 en cours.

## 1. Outillage et versions

| Sujet | Choix | Pourquoi |
| --- | --- | --- |
| Gestionnaire de paquets | npm workspaces, `package-lock.json` unique à la racine | Aucun pnpm sur la machine de développement ; `npm ci` suffit en CI et dans le Dockerfile |
| Node | 22 LTS (`node:22-alpine` en image) | Support long, disponible en amd64 et arm64 |
| TypeScript | 5.9, `strict` partout | NestJS repose sur `emitDecoratorMetadata`, non pris en charge par le compilateur natif de TypeScript 7 |
| NestJS | 12, plateforme Express | Version courante |
| Prisma | 6.x, générateur `prisma-client-js`, `previewFeatures = ["postgresqlExtensions"]` | Le schéma fourni utilise `url = env(...)` dans le datasource, forme abandonnée par Prisma 7 ; l'extension `pg_trgm` est déclarée dans le schéma |
| Hachage | `@node-rs/argon2` (Argon2id) | Binaires précompilés pour musl amd64 et arm64 : pas de compilation native dans l'image |
| Front | React 19, Vite 7, Tailwind 4, React Router 7, TanStack Query 5, `vite-plugin-pwa` | Écosystème du cahier des charges |
| Scan | `BarcodeDetector` natif, repli `zxing-wasm` | Section 5, niveau 1 |
| Tests | Vitest ; base PostgreSQL 16 embarquée (`embedded-postgres`) en local, service `postgres:16-alpine` en CI | Ni Docker ni PostgreSQL ne sont installés sur la machine de développement ; Testcontainers exigerait Docker |
| Journalisation | `nestjs-pino`, JSON sur stdout, identifiant de requête | Section 21 |

## 2. Arborescence

Celle de `CLAUDE.md`, qui précise la section 18 : le schéma Prisma et ses
migrations restent dans `prisma/` à la racine (et non `apps/api/prisma/`).
L'API le référence par `--schema ../../prisma/schema.prisma`.

```
apps/api/src/{auth,users,locations,products,stock,recognition,media,health,common}
apps/web/src/{screens,components/{scanner,forms,ui},lib,hooks}
packages/shared/src/{schemas,rules,units,constants}
prisma/{schema.prisma,migrations,seed}
docker/{Dockerfile,entrypoint.sh}
tools/
docs/
```

## 3. Une seule image, trois services

L'image `ghcr.io/djkix/kitchen-inventory` contient l'API NestJS compilée et
le front Vite compilé. NestJS sert `/api/v1/*` et, pour tout autre chemin, les
fichiers statiques du front avec repli sur `index.html` (application
monopage). Le compose de production comprend `app`, `db` et `backup`, comme
la section 9. Différence avec magazine-search : une image au lieu de deux,
puisque le cahier des charges impose « API + front » dans un même conteneur.

L'entrypoint joue `prisma migrate deploy` puis démarre le serveur. Si la
migration échoue, il affiche la cause, attend `MIGRATION_FAILURE_DELAY_SECONDS`
(30 s par défaut, pour ne pas boucler à la seconde) et sort en erreur, sans
démarrer sur un schéma partiel. Le conteneur tourne sous l'utilisateur `node`.

## 4. Schéma : compléments au fichier fourni

Le `schema.prisma` livré est repris tel quel, avec ces ajouts, tous couverts
par la migration initiale :

- `User.failedLogins Int @default(0)` et `User.lockedUntil DateTime?` : le
  verrouillage temporaire après échecs répétés (section 10) doit survivre à un
  redémarrage du conteneur, donc vivre en base.
- `Session.revokedAt DateTime?` : « expiration longue mais révocable ».
- `ServiceToken` (`id`, `name`, `tokenHash`, `createdAt`, `lastUsedAt`) :
  jeton machine-à-machine en lecture seule prévu dès le lot 1 par la
  section 11. Seul le hachage est stocké.
- `Setting` (`key` unique, `value Json`) : réglages d'instance (seuil
  d'alerte) modifiables depuis l'écran Réglages.
- `Location.path` est unique par arbre ; le `path` est recalculé sur toute la
  descendance quand un emplacement est renommé ou déplacé.

## 5. Authentification et durcissement

- Aucun compte par défaut. `GET /api/v1/auth/status` (publique) renvoie
  `{setupRequired}` ; `POST /api/v1/auth/setup` (publique) crée le premier
  administrateur et n'est acceptée que si la table `User` est vide. Le front
  affiche l'écran d'installation quand `setupRequired` est vrai.
- Session : identifiant aléatoire de 32 octets, stocké haché en base, cookie
  `sid` `httpOnly`, `Secure` (hors `NODE_ENV=development`), `SameSite=Lax`,
  durée 90 jours, glissante. Révocation par `POST /auth/logout` et depuis la
  fiche utilisateur (toutes les sessions).
- Connexion : 10 tentatives par minute et par adresse (throttler) ;
  verrouillage du compte 15 minutes après 5 échecs consécutifs. La réponse
  reste `401 unauthenticated` avec le même message qu'un mot de passe faux ;
  le verrouillage donne `429 rate_limited`.
- `X-Robots-Tag: noindex, nofollow` et un `robots.txt` interdisant tout.
- Les médias sont servis par `GET /api/v1/media/*` derrière la session ; le
  volume n'est jamais exposé en statique.
- Le jeton de service se présente par `Authorization: Bearer <token>` et
  n'ouvre que les routes `GET`.

## 6. Reconnaissance (section 5)

- `RecognitionProvider` est une interface TypeScript
  (`recognize(image, hint) → suggestion`). Implémentations livrées :
  `none` (désactivé), `anthropic`, `openai`, `ollama`. Le fournisseur est
  choisi par `VISION_PROVIDER` au démarrage.
- Le fournisseur reçoit une image redimensionnée à 1024 px de large côté
  client, avant envoi. Le serveur refuse au-delà de 4 Mo.
- Le fournisseur renvoie un JSON strict validé par Zod : `name`,
  `originalName`, `brand`, `category`, `packaging`, `expiryDate`,
  `confidence`. Toute réponse non conforme est traitée comme un échec de
  reconnaissance (journalisé, jamais inventé).
- Quota : `VISION_DAILY_QUOTA` appels par jour (50 par défaut) ; au-delà,
  `429 rate_limited` avec le compteur du jour.
- Open Food Facts : `GET https://world.openfoodfacts.org/api/v2/product/{ean}`
  avec l'en-tête `User-Agent` de `OFF_USER_AGENT`, délai 5 s. Un échec réseau
  est journalisé et la cascade continue.
- Tests : réponses d'Open Food Facts et des fournisseurs de vision rejouées
  depuis `apps/api/test/fixtures/`, le client HTTP étant injecté.

## 7. Recherche tolérante (EF-11)

`pg_trgm` avec `similarity()` sur `Product.name`, `Product.originalName` et
`Product.brand`, seuil 0,3, complétée par une table de synonymes statique dans
`packages/shared` (par exemple « nouilles » ↔ « ramen », « udon », « soba »),
appliquée à la requête avant l'appel SQL. Les synonymes ne sont pas
modifiables en base au lot 1.

## 8. Règles de stock

Les règles de la section 15 sont des fonctions pures de
`packages/shared/src/rules/` : conversions d'unités, date effective, plafonnement
d'une consommation, rapprochement de doublons, regroupement d'un lot existant
à date identique. Le service `stock` de l'API les appelle, insère le mouvement
puis recalcule `quantity` comme somme des `delta` dans la même transaction.
Chaque écriture accepte un `clientOpId` ; un identifiant déjà connu renvoie le
résultat précédent sans rejouer l'opération.

## 9. Données initiales

Au démarrage, l'API crée de façon idempotente les catégories de la section 22
et les cuisines. Les emplacements proposés (cuisine › placard, réfrigérateur,
congélateur ; cellier) sont créés à la création du premier administrateur.
Un script `prisma/seed/dev.ts` produit le jeu de données de développement
de la section 19, avec des dates relatives au jour d'exécution.

## 10. Livraison « comme magazine-search »

| Élément | Reprise de magazine-search | Adaptation |
| --- | --- | --- |
| `ci.yml` | gitleaks, typecheck, lint, tests, migrations rejouées sur Postgres 16, build d'image sans push | Un seul job de build, `npm ci` à la racine, `prisma migrate deploy` puis `migrate reset` pour vérifier la rejouabilité |
| `docker-build.yml` | Publication GHCR sur push `main` et tag `v*`, `workflow_call` depuis release-please | Une image, plateformes `linux/amd64,linux/arm64` |
| `release-please.yml` | Identique | Identique |
| `docker-compose.yml` | Image GHCR avec `IMAGE_TAG`, `db-backup` avec script de rotation | Services `app`, `db`, `backup` ; le script sauvegarde aussi le dossier média |
| `.env.example` | Documenté, sans secret | Variables de la section 9 |
| `.pre-commit-config.yaml` | gitleaks + hooks génériques | Sans ruff |
| `LICENSE` | MIT | Identique |

Le compose de développement local (`docker-compose.dev.yml`) construit
l'image depuis le Dockerfile ; le compose de production tire l'image publiée.

## 11. Ce qui n'est pas fait dans la session de départ

- Tests bout en bout Playwright (section 19) : le parcours de scan dépend de la
  caméra du téléphone ; à écrire quand la stack tourne réellement.
- Jeu de non-régression de reconnaissance sur 50 photos : suppose des photos
  réelles du foyer.
- Mode hors ligne (`/sync`, file IndexedDB), seuils et liste de courses,
  notifications, export : lot 2. Les écritures portent déjà `clientOpId`.
