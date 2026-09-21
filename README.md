# Kitchen Inventory — inventaire alimentaire maison

Application web auto-hébergée qui inventorie les produits comestibles de la
maison par scan depuis le téléphone, suit les dates de péremption et, à terme,
propose des recettes réalisables avec ce qui est réellement en stock.

## Le principe

On se place devant un placard, on choisit l'emplacement une fois, puis on
enchaîne les scans : la caméra reste ouverte, chaque code-barres reconnu ajoute
un article avec quantité 1 et une annulation possible pendant cinq secondes.
Quand un produit n'a pas de code-barres lisible ou n'est connu d'aucune base,
une photo suffit : un modèle de vision propose une fiche (nom français, nom
d'origine translittéré, marque, catégorie, date de péremption lue sur
l'emballage), que l'on valide ou corrige. La correction est mémorisée : au
second scan, plus aucune IA n'est appelée.

La reconnaissance suit une cascade, du moins cher au plus coûteux :

1. décodage du code-barres dans le navigateur, sans réseau ;
2. cache local des produits déjà rencontrés ;
3. [Open Food Facts](https://world.openfoodfacts.org), base publique sans clé ;
4. modèle de vision (Google Gemini par défaut ; Anthropic, OpenAI ou Ollama
   en local au choix), derrière une interface qui permet d'en changer sans
   toucher au reste.

Le tout tourne à la maison : trois conteneurs, PostgreSQL, un dossier de
photos. Seules les photos d'articles envoyées au fournisseur de vision quittent
le réseau, jamais l'inventaire.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Première connexion](#première-connexion)
- [Mise à jour](#mise-à-jour)
- [Sauvegarde et restauration](#sauvegarde-et-restauration)
- [Configuration](#configuration)
- [Intégrations](#intégrations)
- [Développement](#développement)
- [Stack technique](#stack-technique)
- [Licence](#licence)

## Fonctionnalités

**Scan en rafale.** Code-barres EAN-8, EAN-13, UPC et QR décodés dans le
navigateur (`BarcodeDetector` natif, repli ZXing en WebAssembly). Retour
haptique et sonore, emplacement courant collant, annulation cinq secondes.

**Reconnaissance photo.** Étiquettes japonaises, coréennes, chinoises et thaïes
lues et traduites ; le nom d'origine est conservé avec ses idéogrammes. Entre
50 et 80 % de confiance, la fiche est proposée avec des champs « à vérifier » ;
sous 50 %, l'application demande une nouvelle photo plutôt que d'inventer.
Quota journalier configurable et compteur de coût dans les réglages.

**Stock et péremption.** Un produit (le référentiel) se distingue d'un lot (un
exemplaire physique avec sa date et son emplacement). DLC dépassée en rouge,
DDM dépassée en orange, date estimée signalée par une icône pour les
périssables non emballés. À l'ouverture d'un produit, la date effective tient
compte de la durée après ouverture de sa catégorie. Vue « périme bientôt »
avec seuil réglable.

**Mouvements autoritaires.** La quantité d'un lot est la somme de ses
mouvements (entrée, consommation, ajustement, perte) ; chaque écriture porte un
identifiant d'opération, donc rejouer une requête ne compte jamais deux fois.
Une consommation qui dépasse le stock est ramenée au disponible, avec un
message explicite.

**Emplacements imbriqués** à profondeur libre : pièce, meuble, étagère, bac,
autant de niveaux que voulu. La suppression est refusée tant qu'il reste du
stock, avec la proposition de le déplacer vers le parent.

**Recherche tolérante** aux fautes et aux synonymes : « nouilles » trouve
« ramen », « tomat » trouve « Tomates pelées », la recherche porte aussi sur le
nom d'origine et la marque.

**Multi-utilisateur** sur un inventaire partagé, comptes locaux, sessions
révocables, verrouillage après échecs répétés, jeton de service en lecture
seule pour Home Assistant. Export CSV et JSON.

Le module recettes (suggestions par taux de couverture du stock, filtres par
difficulté et type de cuisine) est planifié au lot 2, une fois l'inventaire
fiable : voir `docs/cahier-des-charges.md`, section 12.

## Installation

### Prérequis

- Un hôte Docker (mini-PC, NAS, Raspberry Pi : l'image existe en `amd64` et
  `arm64`) avec `docker compose`.
- Un reverse proxy qui termine le TLS avec un certificat valide (Nginx Proxy
  Manager, Caddy, Traefik…). **Ce n'est pas un confort : l'accès à la caméra
  du téléphone n'est autorisé qu'en HTTPS.**

### Déployer

```bash
mkdir kitchen-inventory && cd kitchen-inventory
curl -fsSLO https://raw.githubusercontent.com/djkix/kitchen-inventory/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/djkix/kitchen-inventory/main/.env.example
mkdir -p docker && curl -fsSL -o docker/backup.sh https://raw.githubusercontent.com/djkix/kitchen-inventory/main/docker/backup.sh
cp .env.example .env
```

Renseigner `.env` : `SECRET_KEY` et `POSTGRES_PASSWORD` (générés avec
`openssl rand -hex 32`), `PUBLIC_URL` (l'adresse HTTPS publique), et fixer
`IMAGE_TAG` sur une version précise plutôt que `latest`. Puis :

```bash
docker compose up -d
docker compose logs -f app
```

Le conteneur `app` joue les migrations de base avant de démarrer, puis répond
sur `http://127.0.0.1:8090` (port modifiable par `APP_PORT`). Pointer le
reverse proxy vers ce port. Vérification :

```bash
curl -s http://127.0.0.1:8090/api/v1/health
```

La réponse détaille séparément la base, le volume média et les migrations. Un
fournisseur de vision désactivé apparaît dans `degraded` sans empêcher le
service : un placard s'inventorie très bien sans IA.

Sous [Dockge](https://github.com/louislam/dockge), coller le contenu de
`docker-compose.yml` et de `.env` dans une nouvelle stack ; le script de
sauvegarde doit être présent dans `docker/backup.sh` à côté du compose.

## Première connexion

Aucun compte n'existe à l'installation. La première visite de l'URL publique
affiche l'écran d'installation qui crée l'administrateur (mot de passe de douze
caractères minimum) et propose des emplacements par défaut (cuisine, placard,
réfrigérateur, congélateur, cellier), renommables ou supprimables. Les autres
membres du foyer sont créés depuis Réglages › Utilisateurs.

Sur le téléphone, « Ajouter à l'écran d'accueil » installe l'application
(PWA). Le thème sombre est activé par défaut, pensé pour un cellier peu éclairé.

## Mise à jour

```bash
# Dans .env, passer IMAGE_TAG à la version voulue, puis :
docker compose pull && docker compose up -d
```

Les migrations de schéma sont appliquées automatiquement au démarrage. Si une
migration échoue, le conteneur affiche la cause, attend trente secondes et
s'arrête sans démarrer sur un schéma partiel ; la base reste dans l'état
précédent. Le déploiement reste volontairement manuel : pas de mise à jour
automatique en production.

Chaque version publiée sur GitHub est accompagnée d'une note de changement
(`CHANGELOG.md`, généré par release-please) ; les migrations incluses sont
visibles dans `prisma/migrations`.

## Sauvegarde et restauration

Le service `backup` produit chaque jour un dump PostgreSQL compressé
(`db-<horodatage>.sql.gz`) et une archive du dossier média
(`media-<horodatage>.tar.gz`) dans `BACKUP_DIR`, avec purge au-delà de
`BACKUP_RETENTION_DAYS` (30 jours). Placer ce répertoire sur un autre disque
que `PGDATA_DIR`.

Restauration à blanc, à tester **avant** la mise en service :

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -c 'CREATE DATABASE kitchen_restore'
gunzip -c backups/db-<horodatage>.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" -d kitchen_restore
```

Restauration complète (service arrêté) :

```bash
docker compose stop app backup
gunzip -c backups/db-<horodatage>.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
tar xzf backups/media-<horodatage>.tar.gz -C ./media
docker compose start app backup
```

## Configuration

Toutes les variables sont documentées dans `.env.example`. Les principales :

| Variable | Rôle |
| --- | --- |
| `SECRET_KEY` | Secret de signature des cookies, 32 caractères minimum, obligatoire |
| `PUBLIC_URL` | URL publique HTTPS |
| `VISION_PROVIDER` | `none`, `gemini` (retenu), `anthropic`, `openai` ou `ollama` |
| `VISION_API_KEY`, `VISION_MODEL`, `VISION_BASE_URL` | Clé et modèle du fournisseur (défaut `gemini-3.5-flash`) ; `VISION_BASE_URL` sert pour Ollama ou un proxy |
| `VISION_DAILY_QUOTA` | Appels photo autorisés par jour (50) |
| `OFF_USER_AGENT` | En-tête demandé par Open Food Facts |
| `EXPIRY_ALERT_DAYS` | Seuil d'alerte par défaut (7), modifiable dans les réglages |
| `LOG_LEVEL` | Niveau des journaux JSON sur la sortie standard |

Les journaux ne contiennent jamais de mot de passe, de cookie ni de contenu
d'image. Chaque appel au fournisseur de vision est journalisé avec sa latence,
son coût estimé et sa confiance ; les compteurs correspondants (appels du jour
et du mois, coût cumulé, taux de reconnaissance automatique sur trente jours,
part des scans résolus par le cache) sont affichés dans les réglages.

## Intégrations

**Home Assistant et autres lecteurs.** Un jeton de service créé dans
Réglages › Jetons de service donne un accès en lecture seule à l'API :

```bash
curl -H "Authorization: Bearer kit_…" https://inventaire.example.org/api/v1/stock/expiring?days=7
```

Toute méthode autre que `GET` est refusée avec ce jeton.

**Export.** `GET /api/v1/export/inventory.csv` et `/inventory.json`, derrière
la session ou un jeton de service.

**API.** REST sous `/api/v1`, JSON, erreurs normalisées
`{ "error": { "code", "message", "details" } }` avec des codes stables
(`validation_failed`, `unauthenticated`, `forbidden`, `not_found`, `conflict`,
`business_rule`, `rate_limited`, `provider_unavailable`, `not_ready`). Les
routes sont décrites dans `docs/cahier-des-charges.md`, section 16.

## Développement

Prérequis : Node 22 et npm 11. Ni Docker ni PostgreSQL ne sont nécessaires
pour les tests : une base PostgreSQL 16 embarquée démarre à la volée.

```bash
npm ci
npm run build -w @kitchen/shared
npm test                      # règles métier + API sur base embarquée
npm run typecheck
npm run lint
```

Lancer l'API et le front en développement (un PostgreSQL accessible est requis
pour l'API, par exemple `docker compose up db`) :

```bash
export DATABASE_URL=postgresql://kitchen:kitchen@localhost:5432/kitchen
export SECRET_KEY=$(openssl rand -hex 32)
export NODE_ENV=development
npm run db:migrate
npm run seed:dev -w @kitchen/api   # jeu de données : 40 produits, 60 lots
npm run dev -w @kitchen/api         # http://localhost:3000
npm run dev -w @kitchen/web         # http://localhost:5173, proxy /api
```

Le jeu de développement crée le compte `admin@example.org` avec le mot de
passe `inventaire-dev-2026` si aucun utilisateur n'existe.

Construire l'image localement :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Structure du dépôt (imposée, voir `CLAUDE.md`) : `apps/api` (NestJS, un
dossier par domaine), `apps/web` (React + Vite, un dossier par écran),
`packages/shared` (types, schémas Zod, unités, règles métier pures),
`prisma` (schéma et migrations), `docker`, `docs`, `tools`.

Le document de référence est `docs/cahier-des-charges.md` ; les choix
d'implémentation laissés au jugement sont consignés dans `docs/decisions/`.
Les commits suivent Conventional Commits avec la référence de l'exigence
(`feat(scan): cascade de reconnaissance (EF-03)`).

## Stack technique

TypeScript de bout en bout. NestJS 12 et Prisma 6 sur PostgreSQL 16
(extension `pg_trgm` pour la recherche tolérante) côté API ; React 19, Vite,
Tailwind et `vite-plugin-pwa` côté front ; Zod pour les schémas partagés ;
Argon2id pour les mots de passe ; Vitest pour les tests. Une seule image
Docker sert l'API et le front compilé ; l'intégration continue GitHub Actions
vérifie types, lint, tests, cohérence des migrations, puis publie l'image
multi-architecture sur GitHub Container Registry à chaque version taguée par
release-please.

## Licence

MIT, voir `LICENSE`.
