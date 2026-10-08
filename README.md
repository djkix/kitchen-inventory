# Kitchen Inventory — inventaire alimentaire maison

Application web auto-hébergée qui inventorie les produits comestibles de la
maison par scan depuis le téléphone, suit les dates de péremption et suggère
des recettes à partir de ce qui est réellement en stock, trouvées sur le web
ou composées par une IA.

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
4. modèle de vision (Google Gemini ; le modèle se choisit dans Réglages),
   derrière une interface qui permet de changer de fournisseur sans toucher
   au reste.

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
- [Derniers changements](#derniers-changements)
- [Licence](#licence)

## Fonctionnalités

**Scan en rafale.** Code-barres EAN-8, EAN-13, UPC et QR décodés dans le
navigateur (`BarcodeDetector` natif, repli ZXing en WebAssembly). Retour
haptique et sonore, emplacement courant collant, annulation cinq secondes.
Chaque lecture ouvre un tiroir de validation : le produit reconnu est affiché
avec sa photo et sa marque, la quantité est ajustable au pas de son unité
(une pièce, 100 g, 0,1 l), et rien n'entre en stock avant confirmation. La
date de péremption peut s'y saisir dans le même geste, par un raccourci
(« +3 j », « +1 sem », « +1 mois ») ou en date libre avec le choix DLC/DDM —
mais rien n'est obligatoire : valider sans y toucher reste le même bouton,
au même endroit. Une date oubliée se rattrape ensuite depuis le bandeau
« Ajouté : … », sans quitter la caméra. Un article déjà validé n'est relu
que lorsqu'il a quitté le champ de la caméra.

**Reconnaissance photo.** La prise de vue passe par l'appareil photo du
téléphone, pour profiter de l'autofocus, du flash et de la stabilisation : une
étiquette dorée ou gravée dans un placard peu éclairé se lit nettement mieux
qu'avec une capture du flux vidéo. Étiquettes japonaises, coréennes, chinoises
et thaïes lues et traduites ; le nom d'origine est conservé avec ses
idéogrammes. Entre 50 et 80 % de confiance, la fiche est proposée avec des
champs « à vérifier » ; sous 50 %, l'application demande une nouvelle photo
plutôt que d'inventer. Deux garde-fous de dépense : un quota d'appels par jour
et un plafond mensuel en euros, tous deux visibles dans les réglages. La photo
reste disponible même quand la caméra du navigateur est refusée, cas d'un accès
sans HTTPS où le scan de code-barres, lui, est impossible.

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

**Recherche tolérante** aux fautes, aux synonymes et aux accents : « nouilles »
trouve « ramen », « tomat » trouve « Tomates pelées », « creme » trouve
« Crème fraîche » même saisi sans accent depuis un téléphone, la recherche
porte aussi sur le nom d'origine et la marque.

**Multi-utilisateur** sur un inventaire partagé, comptes locaux, sessions
révocables, verrouillage après échecs répétés, jeton de service en lecture
seule pour Home Assistant. Export CSV et JSON.

**Module recettes.** L'onglet **Recettes** de la barre du bas ouvre un écran à
deux volets, **Suggestions** et **Mes recettes**, avec une bascule en tête
visible sans défilement (le volet actif ne se distingue pas par la seule
couleur : bordure, fond et poids du texte changent, et un lecteur d'écran
l'annonce). L'application se souvient du dernier volet ouvert et y retombe
directement à la prochaine ouverture de l'onglet — ou sur Suggestions si le
stockage du téléphone est indisponible (navigation privée).

L'écran **Suggestions** est la porte d'entrée : sans
rien demander, l'application compose un point de départ depuis le stock réel
(huit ingrédients au plus, les plus structurants, trois places tournant d'un
jour à l'autre pour renouveler les idées), interroge Google Gemini et affiche
une fournée d'une douzaine de recettes — certaines trouvées sur de vrais
sites, d'autres composées par le modèle, chaque carte disant laquelle (nom du
site, ou « proposée par l'IA »). Gemini classe chaque recette par **type de
plat** — entrée, plat, dessert, accompagnement, apéritif, petit-déjeuner,
boisson — sur la même taxonomie que « Mes recettes » : une suggestion
conservée garde son classement sans reclassement manuel.

Quatre rangées permettent de s'orienter. Le **type de plat** vient en premier,
c'est la question posée avant toutes les autres ; il **filtre la fournée déjà
affichée**, sans appel ni dépense. Viennent ensuite la **région** (asiatique,
méditerranéenne…), la **durée** (≤ 15, ≤ 30, ≤ 60 min) et la **facilité** :
ces trois-là relancent une vraie recherche ciblée auprès du modèle, elles ne
filtrent jamais ce qui est déjà affiché — la cascade ne peut pas promettre une
recette asiatique si le lot courant n'en contenait aucune. Quand le filtre par
type ne laisse aucune recette, l'écran propose explicitement d'en chercher une
nouvelle série ciblée, plutôt que de partir seul : le filtre est gratuit, la
relance ne l'est pas. Une fournée est mise en cache 24 heures par point de
départ et orientation. Les épices, le sel et le
poivre ne sont jamais retenus comme point de départ (l'huile et le vinaigre
le restent) ; les dates de péremption n'interviennent à aucun titre dans les
suggestions.

La fiche d'une suggestion montre les ingrédients et ce qui manque (chacun avec
sa photo, s'il est rapproché d'un produit connu, et la pastille colorée de
l'emplacement de son lot le plus proche de péremption quand il est en stock).
Les étapes d'une recette **composée par l'IA** y sont déjà visibles, puisque
« Plus d'informations » n'a alors rien de plus à aller chercher ; une recette
**trouvée sur le web**, elle, n'affiche encore aucune étape à ce stade — sa
page n'est lue qu'à la conservation, et la fiche l'annonce honnêtement plutôt
que d'en inventer. **Plus d'informations** — un seul geste, pas une
consultation puis une conservation séparée — récupère la page de la recette
(HTTPS uniquement, 5 secondes maximum), lit ses données structurées
`schema.org/Recipe` quand elles existent, et la fait **réécrire par Gemini au
format propre à l'application** — l'application n'envoie jamais vers le site
d'origine, pour une recette composée les étapes déjà produites sont reprises
telles quelles. La difficulté est alors recalculée par le barème du foyer
(elle peut changer d'un cran par rapport à celle affichée avant conservation).
La recette entre dans **Mes recettes**, qui reprend le socle du foyer :
cuisson, historique, notation par membre.

Gemini rend une durée de préparation et une durée de cuisson séparées (`null`
quand la recette n'en a pas, comme une salade, ou que le modèle ne les
distingue pas — jamais un zéro qui se lirait « cuisson : 0 minute ») en plus
de la durée totale affichée sur les cartes, et chaque étape de cuisson doit
préciser température du four, intensité du feu et durée : une étape qui ne le
ferait pas est jugée inexploitable. Les deux durées, une fois la recette
conservée, s'affichent sur la fiche recette (à côté du temps actif et du
repos) et sur la fiche d'une suggestion.

**Mes recettes**, classées **par défaut selon la note** du foyer (les mieux
notées en tête, puis les non notées, titre à l'alphabet en dernier recours) —
le stock n'intervient pas dans ce tri par défaut. La recherche par titre est
tolérante aux accents et à la casse, comme la recherche produits (« crepes »
trouve « Crêpes »). Trois autres tris au choix, mémorisés avec les filtres par
utilisateur : réalisables avec le stock (couverture), les plus faites, les
moins récentes. Filtres par difficulté, cuisine, type de plat, régime, temps
(préparation + cuisson, repos exclu) et note minimale, plus des pastilles
rapides (valeurs sûres, jamais faites, déjà faites, pas faites depuis
longtemps, réalisables maintenant). Chaque carte affiche son **taux de
couverture et son groupe** (prête, presque, incomplète) calculés depuis le
stock réel, même si ce groupe ne change plus l'ordre ni la visibilité de la
liste. Chaque carte affiche aussi la note du foyer et le nombre de
réalisations (« Faite N fois · il y a X jours · ★ Y », ou « Jamais faite »
sans note ni compteur).

Il n'y a **plus de création manuelle** : le bouton d'ajout a disparu, et le
formulaire ne sert plus qu'à **modifier** une recette déjà conservée (titre,
cuisine, type de plat, régimes, portions, temps, étapes, ingrédients). Une
recette de famille qu'on ne trouve pas sur le web n'a, de ce fait, plus sa
place dans l'application.

La fiche d'une recette conservée affiche chaque ingrédient avec, quand elle
existe, la photo du produit rapproché et une pastille colorée (par icône
autant que par teinte — la couleur ne porte jamais seule l'information)
désignant l'emplacement de son lot le plus proche de péremption : ambiant,
frais ou congelé.

Le **nombre de parts** affiché en tête de fiche est ajustable (champ
numérique, initialisé aux portions de la recette) : le modifier recalcule
aussitôt la quantité de chaque ligne et son état face au stock (une ligne
tout juste suffisante à quatre parts peut devenir insuffisante à huit — voir
la limite connue ci-dessous). C'est
le **même nombre**, du premier coup d'œil jusqu'à la cuisson — jamais un
second champ à tenir à côté : il préremplit « Portions réalisées » dans le
tiroir de cuisson, et c'est aussi lui que reprend « J'ai fait cette
recette » pour une réalisation sans décrément.

Depuis la fiche recette, « Cuisiner » ouvre un tiroir de cuisson : portions
réalisées ajustables (préremplies par le nombre de parts choisi sur la fiche),
chaque ligne décrémentable cochée par défaut, choix du
produit retenu (celui qui périme le plus tôt, modifiable) pour toute ligne
substituable ou visant directement une catégorie, et note facultative à cinq
étoiles. La mise à l'échelle des quantités affichées (fiche comme tiroir) suit
une seule règle partagée, exclut du
choix les lots dont la date de péremption est dépassée (comme le calcul de
couverture) et suit la fusion d'un produit s'il en a rejoint un autre
depuis. Une ligne décochée ou sans quantité chiffrée (hors inventaire)
n'émet aucun mouvement ; une ligne chiffrée qui ne résout aucun produit (cas
catégorie sans choix) est signalée plutôt qu'ignorée en silence. Si le stock
ne suffit pas, la quantité retirée est ramenée au disponible plutôt que de
faire échouer la cuisson, et le tiroir le signale en clair ; cuisiner une
recette archivée est refusé. « J'ai fait cette recette » reste disponible
pour une réalisation sans aucun décrément. La
fiche recette porte un bloc Historique (moyenne, nombre de réalisations,
tendance, puis chaque réalisation avec qui a cuisiné et la note de chaque
membre du foyer) : chaque membre note une réalisation de 1 à 5 étoiles, une
fois, modifiable pendant les **sept jours** qui suivent, puis en lecture
seule — y compris une réalisation passée, directement depuis son bouton
« Noter » dans l'historique, sans repasser par une cuisson. Sur l'écran Mes
recettes, un bandeau invite à noter la dernière
réalisation récente encore sans note (pas celle d'une recette depuis
archivée) ; il se ferme pour la journée et se rouvre le lendemain tant qu'il
reste quelque chose à noter.

Une recette jamais cuisinée se supprime réellement ; une recette déjà
réalisée ne se supprime pas (la suppression échoue avec le nombre de
réalisations) mais s'archive, avec restauration possible — l'historique et
les notes sont conservés, la recette archivée ne ressort plus dans les
listes ni les calculs sauf à la chercher explicitement. Une réalisation qui a
décrémenté le stock ne se supprime jamais : la correction se fait depuis la
fiche article, comme pour tout autre mouvement.

Le formulaire (bouton « Modifier » sur la fiche d'une recette conservée)
permet d'ajuster titre, cuisine (choisie ou créée à la volée), type de plat,
régimes, portions, les quatre temps, étapes et ingrédients. Chaque ingrédient
se rattache à un produit existant par la même recherche que le reste de
l'application, à une catégorie, ou reste en texte libre. La difficulté suit
automatiquement les étapes et le temps actif ; une correction manuelle la
gèle définitivement, y compris lors des modifications suivantes. Les
ingrédients envoyés remplacent entièrement les précédents. Quitter le
formulaire avec des changements non enregistrés demande confirmation. Voir
`docs/cahier-des-charges.md`, section 12.

**Limites connues.** Pas d'ajout des ingrédients manquants à une liste de
courses (EF-24, qui suppose l'existence de cette liste, repoussée au lot 2) ;
un ingrédient rapproché par approximation (« crème » → *Crème fraîche épaisse
30 %*) est affiché comme probable, compte comme disponible dans la couverture,
et se confirme ou se corrige au moment de cuisiner, jamais avant ; une recette
composée par l'IA peut inventer une proportion, annoncé par sa mention
« proposée par l'IA », jamais masqué. Augmenter le nombre de parts d'une
recette ne fait jamais basculer son groupe global (prête, presque,
incomplète) vers « presque » ou « incomplète » : seul l'état de chaque ligne
d'ingrédient suit les parts, une recette dont chaque produit a au moins un
lot en stock — même insuffisant pour le nombre choisi — reste annoncée
« Prête ». Sans fournisseur d'IA configuré
(`VISION_PROVIDER=none`), l'écran Suggestions n'appelle rien : il l'explique
et renvoie vers les **Réglages** ; le scan photo affiche de même son écran
dédié plutôt qu'un message passager. Voir `docs/decisions/`.

**Choix des modèles.** Réglages › Reconnaissance propose aux administrateurs
deux lignes de choix : le modèle de la photo et celui des recettes. La liste
n'est pas écrite dans le code — elle est demandée au fournisseur, et ne montre
que les modèles que la clé configurée sert réellement, réduits à la ligne
courante de Gemini : ni instantanés datés, ni aperçus, ni familles parole,
image ou vidéo, qui répondent pourtant à la même API. Si ce filtre ne laissait
rien passer — famille renommée, convention changée — la liste complète reprend
la main plutôt que d'afficher un choix vide. Un nom de modèle
inexistant ne peut donc plus être retenu : c'était la cause de l'écran de
recettes resté vide du 2026-10-04 au 2026-10-06, invisible pour les tests
puisque tous répondent à une doublure locale. « Défaut du serveur » efface le
choix et rend la main à `VISION_MODEL` et `SUGGESTION_MODEL`. Le modèle est
relu à chaque appel : un changement vaut sans redémarrer le conteneur. La
liste dit quels modèles la clé sert, pas lesquels savent chercher sur le web —
un modèle inadapté reste proposé, et l'écran Suggestions affiche alors le
message du fournisseur.

**Recherche web, et son interrupteur.** Les suggestions s'appuient sur l'outil
de recherche de Gemini : une partie des recettes vient de pages réelles, le
reste est composé par le modèle. Cette recherche est facturée **par requête**,
séparément des jetons, et n'entre donc pas dans `VISION_MONTHLY_CAP_CENTS` :
le plafond mensuel de l'application ne la couvre pas. Certaines clés la
refusent aussi, ce qui fait échouer toutes les suggestions. Réglages ›
Reconnaissance porte donc un interrupteur « Recherche web des recettes »,
réservé aux administrateurs. Désactivé, le modèle compose toutes les recettes
lui-même, sans lien vers un site : moins fidèle à l'esprit de la
fonctionnalité, mais gratuit et toujours utile. Quand la recherche est active,
chaque requête réellement exécutée par le modèle est comptée dans le plafond
mensuel, au tarif public de 35 $ pour mille : elles
pèsent bien plus que les jetons, et le plafond les ignorait jusqu'à la 0.12.0.

## Installation

### Prérequis

- Un hôte Docker `amd64` (mini-PC, NAS x86) avec `docker compose`. L'image
  n'est publiée que pour cette architecture ; pour un Raspberry Pi ou un hôte
  arm, la construire localement avec `docker compose -f docker-compose.yml -f
  docker-compose.dev.yml build`.
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
`openssl rand -hex 32`), `PUBLIC_URL` (l'adresse HTTPS publique) et
`IMAGE_TAG`. Ce dernier accepte `latest`, qui suit la dernière version
publiée, ou un numéro figé comme `0.6.1` si vous préférez décider de chaque
montée de version. `latest` ne reçoit jamais un commit de développement : les
poussées sur `main` sont publiées sous l'étiquette `main`, réservée aux
essais. Puis :

```bash
docker compose up -d
docker compose logs -f app
```

Le conteneur `app` ajuste les droits du dossier `media` pour l'utilisateur
`node` (l'entrypoint est le seul moment où root intervient ; le serveur tourne
sans privilège), joue les migrations de base avant de démarrer, puis répond
sur `http://127.0.0.1:8888` (port modifiable par `APP_PORT`). Pointer le
reverse proxy vers ce port. Vérification :

```bash
curl -s http://127.0.0.1:8888/api/v1/health
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
# Avec IMAGE_TAG=latest, rien à modifier :
docker compose pull && docker compose up -d
# Avec un numéro figé, le changer d'abord dans .env.
```

Sous [Dockge](https://github.com/louislam/dockge), le bouton « Update » de la
stack fait la même chose. Avec `IMAGE_TAG=latest`, il suffit donc d'un clic ;
avec un numéro figé, il retélécharge la même image et ne change rien tant que
`.env` n'a pas été modifié.

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
| `VISION_PROVIDER` | `none` ou `gemini` |
| `VISION_API_KEY`, `VISION_MODEL`, `VISION_BASE_URL` | Clé et modèle du fournisseur (défaut `gemini-3.5-flash`) ; `VISION_BASE_URL` sert pour un proxy. Comme `SUGGESTION_MODEL`, `VISION_MODEL` n'est qu'une valeur de départ : le choix fait dans Réglages prime |
| `SUGGESTION_MODEL` | Modèle des appels recettes — suggestions et réécriture (défaut `gemini-3.5-flash-lite`). Distinct de `VISION_MODEL` : lire une étiquette et chercher une recette sur le web n'appellent pas le même modèle. Comme `VISION_MODEL`, c'est une **valeur de départ** : un administrateur peut la remplacer depuis Réglages, et le choix enregistré prime |
| `SUGGESTION_WEB_SEARCH` | `true` (défaut) ou `false` : recherche web réelle pour les suggestions. Valeur de départ seulement — un administrateur bascule l'option depuis Réglages, et son choix prime |
| `VISION_DAILY_QUOTA` | Appels photo autorisés par jour (50) |
| `VISION_MONTHLY_CAP_CENTS` | Plafond de dépense mensuel en centimes, partagé par le scan photo et les suggestions (500, soit 5 €) ; 0 le désactive. Couvre les jetons **et** les requêtes de recherche web |
| `RECIPE_SUGGESTION_DAILY_QUOTA` | Fournées de suggestions de recettes autorisées par jour (20) |
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
`insufficient_stock`, `business_rule`, `provider_disabled`, `rate_limited`,
`provider_unavailable`, `provider_invalid_response`, `not_ready`). Les
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
npm run seed:dev -w @kitchen/api   # jeu de données : 40 produits, 60 lots, 8 recettes avec historique
npm run dev -w @kitchen/api         # http://localhost:3000
npm run dev -w @kitchen/web         # http://localhost:5173, proxy /api
```

Le jeu de développement crée le compte `admin@example.org` avec le mot de
passe `inventaire-dev-2026` si aucun utilisateur n'existe.

Construire l'image localement :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### Tests bout en bout

Une suite Playwright (section 19) joue les parcours P1 à P5 dans un vrai
Chromium (caméra simulée depuis une vidéo fabriquée) contre **l'image Docker
réellement construite** — jamais un serveur de développement — démarrée par
un montage jetable dédié (`docker-compose.e2e.yml`) : une base PostgreSQL 16
vide et une doublure locale d'Open Food Facts et de Gemini
(`e2e/fixtures/stub-server.ts`, qui rejoue les fixtures d'
`apps/api/test/fixtures`). Rien n'est persistant : `down -v` ne laisse rien
derrière lui.

Couverture actuelle : P1 (inventaire initial, scans enchaînés), P2 (rangement
des courses, DLC saisie aussi bien directement dans le tiroir de validation
par raccourci qu'après l'ajout depuis le bandeau ; hors lecture automatique
de la date, qui n'existe pas encore), P3
(consommation, hors bascule en liste de courses — ni seuils ni liste
n'existent), P4 (consultation, recherche, filtre par emplacement, périme
bientôt, hors vue « à racheter » qui dépend de cette même liste de courses),
et P5 (suggestions de recettes, hors cahier des charges, ajouté parce que
c'est la fonctionnalité la plus récente et la plus fragile). Le mode hors
ligne n'est pas couvert non plus, pour la même raison : il n'existe pas
encore (lot 2). La conservation d'une recette trouvée sur le **web** n'est
pas jouée bout en bout : le récupérateur de pages refuse délibérément le HTTP
et les adresses privées ou de bouclage, et une doublure locale tombe dans les
deux cas à la fois — l'assouplir pour le test reviendrait à tester
l'application avec ce garde-fou désarmé. Le parcours conserve donc une
recette composée par l'IA ; l'extraction d'une page reste couverte par les
tests d'intégration, sur cinq formes de pages réelles. Détail et quinze
décisions dans `docs/specs/2026-10-04-tests-bout-en-bout.md`, jugement rendu
dans `docs/decisions/2026-10-04-tests-bout-en-bout.md`.

**Cette suite ne tourne qu'en CI**, sur `main` après chaque fusion — jamais en
local, faute de moteur de conteneurs sur le Mac de Franck. C'est le
compromis : en échange, le job `e2e` de `.github/workflows/ci.yml` publie
toujours en artefact le rapport Playwright et, à chaque échec, les captures,
vidéos et traces (dossier `e2e/artefacts/`) ainsi que les journaux du
conteneur applicatif — c'est là qu'il faut regarder quand ce job est rouge.

Pour la faire tourner quand même (pousser une branche, ou localement avec
Docker) :

```bash
npm run e2e:up      # application sur http://localhost:3100, base sur localhost:55432, doublure sur localhost:3101
npm run e2e:down
```

Pour démarrer sans fournisseur de vision configuré (`VISION_PROVIDER=none`),
ajouter le fichier de surcharge à la commande `docker compose` plutôt que
d'utiliser le script `npm` :

```bash
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e.none.yml up -d --wait
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
`amd64` sur GitHub Container Registry à chaque version taguée par
release-please.

## Derniers changements

| Version | Date | Changement |
| --- | --- | --- |
| 0.14.0 | 2026-10-08 | Lot recettes « complétude et usage ». Gemini rend une durée de préparation et une durée de cuisson séparées (`null` quand la recette n'en a pas, jamais un zéro qui se lirait « cuisson : 0 minute »), affichées sur la fiche recette et sur une suggestion ; chaque étape de cuisson doit préciser température du four, intensité du feu et durée, sous peine d'être jugée inexploitable. Chaque ingrédient affiche la photo du produit rapproché et une pastille colorée de l'emplacement de son lot le plus proche de péremption. « Déjà faites » rejoint les pastilles de filtre rapide de Mes recettes, dont chaque carte affiche déjà note et réalisations. Une réalisation passée se note depuis l'historique de la fiche, sans repasser par une cuisson. « Plus d'informations » remplace « Conserver » sur une suggestion (même geste, même effet). Le nombre de parts affiché sur la fiche recette est désormais ajustable : les quantités par ligne et l'état de chaque ingrédient suivent, et ce même nombre préremplit le tiroir de cuisson — un seul champ du début à la fin. L'onglet Recettes de la barre du bas ouvre désormais un écran à deux volets, Suggestions et Mes recettes, avec une bascule en tête visible sans défilement ; l'application se souvient du dernier volet ouvert (ou retombe sur Suggestions si le stockage est indisponible) |
| 0.13.0 | 2026-10-08 | Les suggestions sont classées par type de plat — entrée, plat, dessert, accompagnement, apéritif, petit-déjeuner, boisson — sur la taxonomie qui existait déjà pour « Mes recettes », et qu'une suggestion conservée emporte avec elle. Le type devient la première rangée de filtres des deux écrans, devant la cuisine ; sur Suggestions il filtre la fournée déjà chargée, sans appel ni dépense, et propose une relance ciblée seulement quand il ne reste rien |
| 0.12.3 | 2026-10-08 | La liste des modèles proposée dans Réglages se limite à la ligne courante de Gemini. La clé en déclare une soixantaine — instantanés datés, aperçus, familles parole, image et vidéo — et les dérouler tous pour choisir entre deux modèles utilisables n'était pas tenable au téléphone. Le filtre reste permissif sur le numéro de version, pour qu'une nouvelle génération apparaisse sans modification du code, et rend la liste complète s'il ne laisse rien passer |
| 0.12.2 | 2026-10-07 | Nettoyage après audit d'over-engineering : suppression des adaptateurs Anthropic, OpenAI et Ollama, jamais configurés ni exercés hors de leurs propres tests, et de la dépendance `@anthropic-ai/sdk` qui ne servait qu'au premier. `VISION_PROVIDER` n'accepte plus que `none` et `gemini` ; l'interface de fournisseur est conservée, c'est elle qui rend un autre fournisseur ajoutable le jour venu. Disparaissent aussi l'interface de fournisseur de suggestions (une seule implémentation), trois fabriques qui ne faisaient que déléguer, la variable `SEARCH_COST_USD_PER_1K` (devenue une constante au même titre que la table de prix), `TZ` dans le schéma de configuration (Node la lit seul) et un libellé de modèle transporté jusqu'au navigateur sans jamais être affiché. Environ 250 lignes et une dépendance en moins, à comportement identique |
| 0.12.1 | 2026-10-07 | Retrait de `temperature` des trois appels Gemini (reconnaissance photo, suggestions, réécriture). Google l'a déprécié avec `top_p` et `top_k` : sans effet depuis Gemini 3.6 Flash, ces paramètres renverront une erreur sur les modèles à venir. Le modèle applique désormais ses propres valeurs. Aucun `thinking_budget` n'était utilisé, rien d'autre à migrer |
| 0.12.0 | 2026-10-07 | Interrupteur « Recherche web des recettes » dans Réglages › Reconnaissance, pour les administrateurs. La recherche web est facturée par requête, hors du plafond mensuel de l'application, et certaines clés la refusent — c'est ce refus qui faisait échouer toutes les suggestions chez Franck. Désactivée, le modèle compose les recettes lui-même, avec une consigne explicite de ne pas inventer de lien vers un site. Activée par défaut : c'est la fonctionnalité demandée, pas une option. Les requêtes de recherche entrent désormais dans le plafond mensuel : facturées par requête et non par jeton, elles lui échappaient entièrement, si bien qu'il annonçait une protection qu'il n'assurait pas dès que la recherche était active. Une fournée de douze recettes coûte plus cher en recherches qu'en jetons |
| 0.11.0 | 2026-10-06 | Les administrateurs choisissent les modèles depuis Réglages, section Reconnaissance : une ligne pour la photo, une pour les recettes. La liste proposée est celle que la clé sert réellement, interrogée auprès du fournisseur — un nom de modèle inexistant ne peut donc plus être saisi, ce qui était la cause de l'écran de recettes vide. Le choix prime sur `VISION_MODEL` et `SUGGESTION_MODEL`, et « Défaut du serveur » rend la main à ces variables. Le modèle est relu à chaque appel : un changement vaut immédiatement, sans redémarrage du conteneur |
| 0.10.0 | 2026-10-06 | Le numéro de version ne s'affiche plus qu'au bas de l'écran Réglages, au lieu de chaque écran et de la page de connexion : c'est une information d'administration, et le bandeau « Nouvelle version disponible » continue de signaler partout qu'une mise à jour attend. L'écran Suggestions reprend désormais le message du serveur quand la recherche échoue — « en erreur (404) », « en erreur (429) » — au lieu d'un « le modèle n'a pas pu répondre » qui ne distinguait pas un modèle mal configuré d'un quota épuisé ou d'une coupure réseau, et obligeait à aller lire les journaux du serveur |
| 0.9.2 | 2026-10-05 | Correctif : aucune suggestion de recette n'avait jamais abouti depuis la 0.8.0. Les appels partaient vers `gemini-3.5-pro`, un modèle que l'API Gemini ne sert pas — six tentatives, six 404, et un écran « Mes recettes » vide sans que rien ne l'explique. Le modèle des recettes devient `gemini-3.5-flash-lite` par défaut et se règle à part de la reconnaissance photo, par `SUGGESTION_MODEL` : les deux usages n'ont ni le même besoin ni le même prix. Vingt fois moins cher que le modèle visé, il laisse beaucoup plus de marge sous le plafond mensuel. Aucun test ne pouvait voir cette panne : tous parlent à une doublure locale qui répond quel que soit le nom du modèle |
| 0.9.1 | 2026-10-05 | Correctif d'accessibilité : les cartes de recette et de suggestion n'avaient aucun nom annoncé par les lecteurs d'écran, et étaient introuvables par une requête rôle + nom — Chromium ne remonte pas le contenu d'un rôle `article` dans le nom calculé d'un lien ou d'un bouton ancêtre (EF-23). C'est ainsi qu'un test de bout en bout avait perdu une recette qu'il venait de conserver, contournement visible dans `e2e/p5-suggestions.spec.ts` jusqu'ici. Les deux cartes restent entièrement tactiles (usage à une main en cuisine) et portent désormais un nom explicite — titre et état de couverture (« Prête à 100 % »), la même information que le badge coloré, en mots |
| 0.9.0 | 2026-10-05 | La date de péremption se saisit désormais directement dans le tiroir de validation du scan (EF-02), ce que Franck avait demandé puis fait reporter deux fois : sous la quantité, trois raccourcis (« +3 j », « +1 sem », « +1 mois ») ou un lien « autre date » pour la date libre et le choix DLC/DDM. Rien n'est obligatoire — valider sans y toucher reste le même geste qu'avant, même bouton, même nombre de taps — et le bandeau « + DLC » après l'ajout reste disponible pour rattraper un oubli |
| 0.8.3 | 2026-10-05 | Tests des parcours de bout en bout : vingt-huit scénarios rejouent désormais l'application entière dans un vrai navigateur — ranger les courses en scannant, saisir une date de péremption, consommer un article, chercher dans le stock, demander des suggestions de recettes — contre l'image Docker réellement livrée, sans aucun appel à internet. Ils tournent automatiquement après chaque fusion et doivent passer avant toute publication : une panne du genre de celles trouvées ici (« Mes recettes » vide, recherche sourde aux accents) se verra désormais avant d'arriver sur le mini-PC |
| 0.8.2 | 2026-10-05 | Correctif : la recherche du stock ignore désormais les accents (EF-11). « creme » trouvait « Crème fraîche » côté produits mais pas côté stock, car la requête était désaccentuée puis comparée telle quelle au texte brut en base. La comparaison passe désormais par `unaccent_lite()` (déjà utilisée pour la détection de doublons) appliquée au texte stocké, via une résolution d'identifiants en SQL brut réinjectés dans le filtre existant ; au passage, `unaccent_lite()` ne savait pas déplier les ligatures Œ/œ/Æ/æ (deux lettres) avec `translate()`, qui ne sait remplacer qu'un caractère par un seul autre — « oeufs » ne trouvait donc pas « Œufs » ; migration `0007_unaccent_lite_ligatures` |
| 0.8.1 | 2026-10-05 | Correctif : « Mes recettes » n'affichait jamais une recette conservée. Le filtre `archived=false` envoyé par l'écran était converti en `true` (`Boolean("false")` vaut `true` en JavaScript), si bien que seule la liste des recettes archivées était rendue. Trouvé par les tests bout en bout, qu'aucun test d'API ne pouvait révéler puisqu'ils passent un vrai booléen |
| 0.8.0 | 2026-10-04 | Recettes suggérées à partir du stock (EF-26) : écran Suggestions en entrée du module, point de départ composé depuis le stock réel, recherche web et composition par Gemini, orientation par région/durée/facilité relançant une recherche ciblée, conservation d'une suggestion réécrite au format de l'application dans Mes recettes (EF-25) ; création manuelle retirée, le formulaire ne sert plus qu'à modifier ; `VISION_MONTHLY_CAP_CENTS` plafonne désormais scan et suggestions ensemble, porté à 5 € ; `RECIPE_SUGGESTION_DAILY_QUOTA` ; migrations `0005_recipe_suggestions` et `0006_recipe_client_op_id` ; une recette mal formée n'emporte plus la fournée entière, chaque appel au fournisseur est journalisé pour que quota et plafond soient justes, l'identité d'une suggestion vient de son contenu et non de son rang, code d'erreur `insufficient_stock` dédié ; le scan retrouve son écran dédié quand aucun fournisseur n'est configuré, et les fournées ne faussent plus ses statistiques |
| 0.7.0 | 2026-10-04 | Module recettes (socle) : écran Recettes trié par note avec filtres et tris mémorisés (EF-21, EF-22, EF-23) ; fiche recette avec état de chaque ingrédient et historique noté par membre (EF-23, EF-28) ; cuisson avec décrément plafonné au stock, lots périmés écartés, fusion de produit suivie et choix du produit substitué, ou réalisation sans décrément (EF-18, EF-28) ; archivage d'une recette déjà cuisinée, cuisson d'une recette archivée refusée ; formulaire de saisie et de modification (EF-17) ; recherche de titre insensible aux accents (A22) ; ajout aux courses (EF-24), import par URL (EF-25) et génération par IA (EF-26) laissés au lot 2 |
| 0.6.1 | 2026-10-03 | Publication : « latest » ne suit plus que les versions publiées, les poussées sur main vont sous « main » |
| 0.6.0 | 2026-10-03 | Bandeau de mise à jour : nouvelle version détectée et rechargement proposé, sans interrompre un scan |
| 0.5.0 | 2026-09-21 | Version affichée au bas de chaque écran, alerte quand l'interface en cache est périmée ; publication de l'image limitée à amd64, l'architecture de l'hôte |
| 0.4.0 | 2026-09-21 | Photo prise par l'appareil natif du téléphone, plafond de dépense mensuel en euros |
| 0.3.0 | 2026-09-21 | Scan : validation du produit et de la quantité avant ajout ; fin des ajouts répétés du même article |
| 0.2.2 | 2026-09-21 | Déploiement : droits du volume `media` ajustés au démarrage, plus de `chown` manuel |
| 0.2.1 | 2026-09-21 | Configuration : les variables vides transmises par Compose (`VISION_BASE_URL=`) sont ignorées au lieu de bloquer le démarrage |
| 0.2.0 | 2026-09-21 | Reconnaissance photo : fournisseur Google Gemini (`gemini-3.5-flash`), retenu par défaut ; port hôte 8888 |
| 0.1.0 | 2026-09-21 | Lot 1 : authentification, emplacements, produits, stock et mouvements, scan code-barres, Open Food Facts, vision, export, PWA mobile, stack Docker |

**L'historique complet est dans [`CHANGELOG.md`](./CHANGELOG.md)**, généré
automatiquement par release-please à chaque version publiée. La version en
service est affichée au bas de l'écran **Réglages**, et renvoyée par
`GET /api/v1/health` (champ `version`). Elle n'apparaît plus sur les autres
écrans : c'est une information d'administration, et le bandeau de mise à jour
ci-dessous suffit à signaler qu'une version plus récente attend.

Quand une nouvelle version est déployée, l'application la détecte et propose un
bandeau « Nouvelle version disponible · Recharger » au-dessus de la barre de
navigation. La vérification a lieu au lancement, toutes les trente minutes
application ouverte, et à chaque retour au premier plan — sans quoi une version
déployée en journée n'arriverait sur le téléphone qu'au prochain démarrage
complet. Le rechargement n'est jamais imposé : il interromprait une session de
scan, et le bandeau reste d'ailleurs masqué derrière l'écran de scan.

## Licence

MIT, voir `LICENSE`.
