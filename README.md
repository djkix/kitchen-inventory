<div align="center">

# 🥫 Kitchen Inventory

**Inventaire alimentaire maison — scan · péremptions · recettes · ticket de caisse**

[![Version](https://img.shields.io/badge/version-0.30.0-emerald?style=for-the-badge)](https://github.com/djkix/kitchen-inventory)
[![Stack](https://img.shields.io/badge/stack-React_19_·_NestJS_·_PostgreSQL-blue?style=for-the-badge)](#stack-technique)
[![License](https://img.shields.io/badge/license-MIT-slate?style=for-the-badge)](#licence)

*Savoir ce qu'il y a au fond du placard, et ce qu'on peut en cuisiner. Auto-hébergé, pensé pour le téléphone.*

<br />

```
┌──────────────────────────────────────────────────────────────┐
│  Kitchen Inventory                               v0.30.0     │
├──────────────────────────────────────────────────────────────┤
│  🔍 Rechercher un article…                                   │
│                                                              │
│  Cellier › Étagère haute          Périme bientôt (3)         │
│  ─────────────────────────        ──────────────────         │
│  Riz basmati            ×2        Crème fraîche    J-2       │
│  Lentilles vertes       ×1        Jambon blanc     J-4       │
│  Huile d'olive          ×2        Yaourts nature   J-6       │
│                                                              │
│  Suggestions   « il me reste du poulet… » 🎤                 │
│  Dahl de lentilles      prête · 12 notes · 25 min            │
│  Riz cantonais          presque · il manque 1 ingrédient     │
├──────────────────────────────────────────────────────────────┤
│   Stock      Recettes     [ 📷 ]     Courses     Réglages    │
└──────────────────────────────────────────────────────────────┘
```

<br />

[Fonctionnalités](#fonctionnalités) ·
[Installation](#installation) ·
[Première connexion](#première-connexion) ·
[Configuration](#configuration) ·
[Développement](#développement) ·
[Historique](#derniers-changements)

</div>

---

## Vue d'ensemble

**Kitchen Inventory** répond à deux questions : *qu'est-ce que j'ai ?* et
*qu'est-ce que je peux en faire ?* Son terrain est le fond du placard — les
produits qui se gardent, ceux dont on a perdu la trace — plus que le frigo,
qu'on ouvre tous les jours.

| Onglet | À quoi il sert |
|--------|----------------|
| 🥫 **Stock** | Articles par emplacement, recherche tolérante aux fautes, vue « périme bientôt » |
| 🍲 **Recettes** | Suggestions construites sur le stock réel, puis bibliothèque du foyer |
| 📷 **Scan** | Code-barres en rafale, ou photo d'étiquette quand le code ne suffit pas |
| 🧾 **Courses** | Un ticket de caisse photographié remplit l'inventaire d'un geste |
| ⚙️ **Réglages** | Emplacements, comptes, modèles d'IA, quotas et dépense, export |

Tout tourne à la maison : trois conteneurs, PostgreSQL, un dossier de photos.
Seules les photos envoyées au fournisseur de vision quittent le réseau —
jamais l'inventaire.

### La cascade de reconnaissance

Du moins cher au plus coûteux, pour qu'un scan ordinaire ne coûte rien :

1. **Code-barres** décodé dans le navigateur, sans réseau ;
2. **Cache local** des produits déjà rencontrés ;
3. **[Open Food Facts](https://world.openfoodfacts.org)**, base publique sans clé ;
4. **Modèle de vision** (Google Gemini), derrière une interface qui permet d'en changer.

Une correction est mémorisée : au second scan du même code, aucune IA n'est
appelée.

---

## Fonctionnalités

### 📷 Scan et reconnaissance

**En rafale.** On choisit l'emplacement une fois, la caméra reste ouverte, et
chaque code reconnu ajoute un article — annulable pendant cinq secondes. EAN-8,
EAN-13, UPC et QR, décodés dans le navigateur.

**Par photo** quand le code manque ou qu'aucune base ne le connaît : un modèle
propose une fiche (nom français, nom d'origine translittéré, marque, catégorie,
date lue sur l'emballage), qu'on valide ou corrige. La DLC se saisit dans le
même tiroir : trois raccourcis (+3 j, +1 sem, +1 mois) ou une date libre.

### 🧾 Le ticket de caisse

L'onglet **Courses** remplit l'inventaire sans scanner article par article. On
choisit l'emplacement, on photographie le ticket — ou on dépose un PDF reçu par
courriel — et les lignes s'affichent **dans l'ordre du papier**, pour qu'on
puisse suivre le ticket en main.

| État de la ligne | Ce qui se passe |
|------------------|-----------------|
| **Reconnue** | Cochée, avec le mouvement de quantité : « 2 → 3 » |
| **Ambiguë** | Jamais cochée en silence : on choisit parmi les candidats |
| **Inconnue** | Décochée, libellé brut affiché — à scanner au code-barres plus tard |

Le libellé brut du ticket figure sous chaque nom, pour vérifier. La quantité se
corrige sur la ligne. Les libellés jamais reconnus s'accumulent dans une liste
qu'on rattache quand on veut, et l'onglet en porte le compte : une fois appris,
le même libellé est reconnu sur tous les tickets suivants.

### 🥫 Stock et péremption

Un **produit** (le référentiel) se distingue d'un **lot** (un exemplaire, avec
sa date et son emplacement). La quantité d'un lot est la somme de ses
mouvements, jamais une valeur écrite directement — une consommation insère un
mouvement puis recalcule.

**Emplacements imbriqués** à profondeur libre : pièce, meuble, étagère, bac.
**Recherche tolérante** aux fautes, aux synonymes et aux accents (« nouilles »
trouve « ramen »). **Vue « périme bientôt »**, avec un seuil d'alerte réglable.

### 🍲 Recettes

**Suggestions** construites sur le stock réel : chaque carte porte son taux de
couverture, ce qui manque, la durée et la difficulté. Orientables par cuisine,
durée ou facilité. Les recettes rapportées entrent dans un **réservoir
permanent** — elles ne s'effacent plus, et le modèle n'est rappelé que s'il en
reste trop peu.

**Vos ingrédients à vous.** Un champ à pastilles, avec autocomplétion depuis le
catalogue : « poulet, tomates » ne rend que des recettes utilisant **tous** ces
éléments — l'objet est d'écouler un reste.

**Demande parlée.** Une icône de micro ouvre un écran à part : on dit *« il me
reste du poulet et un peu de sauce tomate, je veux faire un plat italien »*, et
Gemini écoute, comprend et propose dans le même appel. L'audio n'est conservé
nulle part.

**Mes recettes** est la bibliothèque du foyer : classée par note, filtrable
(difficulté, cuisine, temps, plat, régime), avec favoris, notation par membre
et glissement vers la gauche pour archiver. Cuisiner une recette décrémente le
stock, ajusté au nombre de parts.

### 🔐 Comptes

Connexion par **compte Google**, sans aucun mot de passe. Une adresse inconnue
crée une demande qui attend la validation d'un administrateur, dans Réglages ›
Comptes. Le statut est vérifié à chaque requête : une révocation coupe l'accès
immédiatement. Une [porte de secours](#accès-de-secours) existe si Google
devient inutilisable.

### 💶 Dépense et garde-fous

Les appels au modèle sont bornés par trois mécanismes visibles dans Réglages :
un **quota journalier** par usage (photo, recettes, tickets), un **plafond
mensuel en euros** partagé par tous, et un **modèle de repli** essayé une fois
quand un quota Google est épuisé. Un refus de Google est traduit précisément :
« Trop de demandes coup sur coup, réessayez dans 12 secondes » plutôt qu'un
message indifférencié.

### 📱 Et aussi

Installable en **PWA** (plein écran, icône sur l'écran d'accueil), avec un
bandeau qui propose la mise à jour sans jamais recharger la page sous les
doigts. **Export** CSV et JSON. **Jetons de service** en lecture seule pour
Home Assistant ou un script.

**Limites connues.** Mode hors ligne, alertes de péremption par notification et
export enrichi restent à faire. La liste de courses alimentée par des seuils
(EF-12) et l'ajout des ingrédients manquants d'une recette (EF-24) ont été
**abandonnés** le 2026-10-22 au profit du ticket de caisse.

---

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
sauvegarde doit être présent dans `docker/backup.sh` à côté du compose. **Ne
pas y recopier de fragment de `docker-compose.e2e.yml`** : ce fichier de tests
pose `GOOGLE_CERTS_URL`, qui déplace la racine de confiance de
l'authentification (voir [Configuration](#configuration)).

> **Renseigner `ADMIN_EMAIL` avant le premier démarrage.** Sur une base vide,
> seule cette adresse peut devenir administrateur par connexion Google ; toute
> autre connexion est refusée sans rien créer. Sans `ADMIN_EMAIL`, l'image de
> production ne crée **aucun** administrateur automatiquement : le journal
> l'annonce à chaque tentative, et le premier compte se crée alors avec la
> [porte de secours](#accès-de-secours). Les deux protections valent aussi
> après une restauration sur base vide.

## Première connexion

On se connecte **avec un compte Google**, et avec rien d'autre : il n'y a plus
de mot de passe dans l'application, ni formulaire de connexion, ni écran
d'installation, ni changement de mot de passe. Le flux utilisé est celui du
« jeton d'identité » de Google Identity Services : **pas de client secret**,
une seule valeur à configurer, publique, `GOOGLE_CLIENT_ID`.

### 1. Créer l'identifiant OAuth dans la console Google Cloud

À faire une fois, sur le projet Google Cloud qui sert déjà la clé Gemini (ou
sur un projet neuf, peu importe : le Client ID et la clé d'API n'ont aucun
lien). L'URL publique utilisée ci-dessous est celle de l'instance,
`https://kitchen.example.org` — la même que dans `PUBLIC_URL`.

1. Ouvrir [console.cloud.google.com](https://console.cloud.google.com) et
   sélectionner le projet en haut de la page.
2. **APIs et services → Écran de consentement OAuth.** Si l'écran n'existe pas
   encore : type d'utilisateur **Externe**, puis renseigner le nom de
   l'application, l'adresse d'assistance et l'adresse du développeur. Aucune
   portée (« scope ») à ajouter : le flux n'en demande aucune au-delà de
   l'identité de base.
3. Sur ce même écran de consentement, **passer l'état en « En production »**
   (bouton « Publier l'application »). Laissé en « Test », seuls les comptes
   déclarés un par un dans la liste des testeurs peuvent se connecter, et la
   session expire au bout de sept jours. Ce n'est pas un risque d'ouverture :
   ce qui ferme la porte ici, c'est la validation par un administrateur
   (étape suivante), pas le mode de l'écran de consentement.
4. **APIs et services → Identifiants → Créer des identifiants → ID client
   OAuth.**
5. Type d'application : **Application web**. Nom : ce que vous voulez
   (« Kitchen Inventory » par exemple), il n'est vu que dans la console.
6. **Origines JavaScript autorisées → Ajouter un URI**, et y mettre
   **l'URL publique exacte** :

   ```
   https://kitchen.example.org
   ```

   Exacte veut dire **au caractère près** : le schéma (`https://`), le nom
   d'hôte et, seulement s'il n'est pas standard, le port. **Pas de chemin, pas
   de barre oblique finale.** `https://kitchen.example.org/` et
   `https://kitchen.example.org/connexion` sont refusés, et Google répond
   alors une erreur `origin_mismatch` que rien n'affiche dans l'application :
   le bouton reste simplement sans effet.
7. **Laisser « URI de redirection autorisés » vide.** Ce flux n'utilise aucune
   redirection ; une URI de redirection ne sert à rien ici et son absence
   n'empêche pas de valider le formulaire.
8. Valider. La console affiche le **Client ID**, de la forme
   `123456789012-abcdefghijklmnop.apps.googleusercontent.com`. Le *client
   secret* affiché à côté **ne sert pas** : ne le copier nulle part.
9. Coller ce Client ID dans `.env` :

   ```
   GOOGLE_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
   ```

   puis `docker compose up -d` (sous Dockge : « Save » puis « Update ») pour
   que le conteneur relise la variable. Le Client ID est servi à l'exécution
   par l'API, jamais figé dans l'interface compilée : il suffit de redémarrer
   le conteneur, il n'y a pas d'image à reconstruire.

> **Changement de domaine = retour dans la console.** L'origine autorisée est
> comparée telle quelle par Google. Le jour où l'instance change d'URL
> (nouveau domaine, passage de `http` à `https`, changement de port), il faut
> ajouter la nouvelle origine dans cette même liste, sinon plus personne ne
> peut se connecter. On peut en déclarer plusieurs : pendant une migration,
> garder l'ancienne et la nouvelle évite toute coupure.

### 2. Le premier compte, puis les suivants

Sur une base vide, **la première connexion Google de l'adresse `ADMIN_EMAIL`
crée le compte administrateur** — `ACTIVE` et `ADMIN` — et pose les
emplacements par défaut (cuisine, placard, réfrigérateur, congélateur,
cellier), renommables ou supprimables. Une autre adresse qui se présente avant
reçoit le message d'une demande en attente, et rien n'est créé : la place ne
revient pas au premier qui trouve l'adresse du site. Sans `ADMIN_EMAIL`, aucune
connexion Google ne crée d'administrateur en production : créer le premier
compte avec `docker compose exec app node tools/acces-secours.js
votre-adresse@example.org` (voir [Accès de secours](#accès-de-secours)), puis se
connecter avec Google sous la même adresse. En développement et en test, sans
`ADMIN_EMAIL`, la première connexion crée l'administrateur comme avant.

Ensuite, l'inscription est ouverte mais **l'accès ne l'est pas**. Une adresse
inconnue qui se connecte crée une **demande** : aucune session n'est ouverte,
l'écran annonce que la demande attend une validation, et la personne ne voit
rien de l'inventaire. Un administrateur la valide dans **Réglages › Comptes**,
qui présente quatre listes :

| Liste | Actions |
| --- | --- |
| Demandes en attente | **Valider** (le compte devient actif) ou **Refuser** |
| Comptes actifs | **Déconnecter** (coupe toutes les sessions, téléphone perdu ; la personne peut se reconnecter), **Promouvoir** / **Retirer admin** (partage de l'administration) ou **Révoquer** (retire l'accès et coupe les sessions en cours) |
| Refusés | **Rétablir** |
| Compte (le vôtre) | **Déconnecter tous mes appareils** |

Un compte refusé ou révoqué n'est jamais supprimé : il porte de l'historique de
réalisations et des notes. Une personne refusée qui se reconnecte reçoit
exactement le même message qu'une demande ordinaire — la page de connexion ne
sert pas à savoir quelles adresses le foyer connaît.

Le statut du compte est vérifié **à chaque requête**, pas seulement au moment
de la connexion : révoquer un accès le coupe immédiatement, même sur un
téléphone déjà connecté.

**L'administration se partage.** Sur la ligne d'un compte actif, **Promouvoir**
en fait un administrateur, **Retirer admin** le ramène au rang de membre. Trois
garde-fous : on ne change pas son propre rôle, on ne rétrograde pas le dernier
administrateur actif, et seul un compte déjà actif change de rôle. Il est
conseillé d'avoir **deux administrateurs** : sinon, perdre l'accès à son compte
Google ne laisse que l'[accès de secours](#accès-de-secours).

> **Révoquer un compte ne révoque pas les jetons de service.** Ceux-ci
> n'appartiennent à personne : ce sont des jetons d'**intégration du foyer**
> (Home Assistant, voir [Intégrations](#intégrations)), pas l'accès d'une
> personne. Si quelqu'un qui partait avait noté un jeton, le supprimer dans
> **Réglages › Jetons de service** — c'est le seul geste qui le coupe.

### 3. Sur le téléphone

« Ajouter à l'écran d'accueil » installe l'application (PWA). Le thème sombre
est activé par défaut, pensé pour un cellier peu éclairé.

## Accès de secours

Si la configuration Google casse — projet suspendu, Client ID effacé, domaine
changé sans mise à jour de l'origine autorisée — **plus personne n'entre**.
C'est le prix assumé de « plus de mot de passe », et c'est pourquoi il existe
une porte de secours. Elle n'est **pas** une route cachée ni une variable
d'environnement : c'est une commande, lancée dans le conteneur, qui n'ouvre
rien tant qu'elle n'a pas tourné.

Depuis le terminal de la stack sous Dockge (ou en SSH, dans le répertoire du
`docker-compose.yml`) :

```bash
docker compose exec app node tools/acces-secours.js adresse@example.org
```

Elle crée ou réactive ce compte en `ACTIVE`/`ADMIN` et affiche, **une seule
fois** :

```
Compte créé : adresse@example.org (ACTIVE, ADMIN)
Mot de passe de secours : …
Valable jusqu'à 18/10/2026 14:13:38, pour une seule connexion.
```

Ce mot de passe est **valable une heure**, **utilisable une seule fois**, et
n'est **jamais réaffiché** : il n'existe en clair nulle part ailleurs, pas même
dans les journaux. Il s'utilise sur une route que l'interface ne présente
nulle part, `POST /api/v1/auth/recovery` :

```bash
curl -i -X POST https://kitchen.example.org/api/v1/auth/recovery \
  -H 'Content-Type: application/json' \
  -d '{"email":"adresse@example.org","password":"LE-MOT-DE-PASSE"}'
```

La réponse pose le cookie de session habituel. Pour entrer directement dans le
navigateur plutôt qu'avec `curl`, ouvrir la console de l'application sur son
domaine et y lancer le même appel avec `fetch` : le cookie est posé sur place.

> **Le terminal web de Dockge garde ce qu'il affiche.** C'est une page de
> navigateur : le mot de passe reste dans l'historique de défilement de
> l'onglet, et peut survivre à un rechargement. Le dégât est borné — une
> heure, un seul usage — mais le réflexe est de fermer l'onglet du terminal
> une fois la connexion faite, et de ne pas laisser la fenêtre Dockge ouverte
> sur cette sortie.

Si le conteneur ne démarre pas du tout (migration en échec, par exemple), la
variante qui ne suppose pas un conteneur déjà en service :

```bash
docker compose run --rm app node tools/acces-secours.js adresse@example.org
```

Cette commande suppose un accès au serveur. Sans Dockge ni SSH, il n'y a pas
de recours : c'est la limite assumée du dispositif.

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

> **Si l'application redémarre sur une base vide** — restauration ratée, dump
> absent, volume perdu — la fenêtre du premier administrateur se rouvre : le
> premier qui se connecte devient administrateur du foyer. Vérifier que la
> restauration a bien repeuplé la base **avant** de remettre le service
> derrière le reverse proxy, et se reconnecter sans attendre.

## Configuration

Toutes les variables sont documentées dans `.env.example`. Les principales :

| Variable | Rôle |
| --- | --- |
| `SECRET_KEY` | Secret de signature des cookies, 32 caractères minimum, obligatoire |
| `PUBLIC_URL` | URL publique HTTPS |
| `GOOGLE_CLIENT_ID` | Client ID OAuth « Application web » de la console Google Cloud, **public** (pas de client secret avec ce flux). Vide = la connexion Google est indisponible et le bouton ne s'affiche pas, l'application devenant inaccessible autrement que par la porte de secours. Obtention : [Première connexion](#première-connexion) |
| `ADMIN_EMAIL` | Seule adresse autorisée à devenir le premier administrateur d'une base vide. Absente en production, aucune connexion Google ne crée d'administrateur : passer par la [porte de secours](#accès-de-secours). Sans effet une fois un compte créé |
| `GOOGLE_CERTS_URL` | **Réservée au montage de tests bout en bout, à ne jamais poser ici.** Elle remplace les clés publiques qui valident les jetons Google : qui sert ces clés signe des jetons que l'application accepte. Posée, elle est signalée par un avertissement au démarrage et par `google_certs_url` dans le `degraded` de `/health` |
| `VISION_PROVIDER` | `none` ou `gemini` |
| `VISION_API_KEY`, `VISION_MODEL`, `VISION_BASE_URL` | Clé et modèle du fournisseur (défaut `gemini-3.8-flash`) ; `VISION_BASE_URL` sert pour un proxy. Comme `SUGGESTION_MODEL`, `VISION_MODEL` n'est qu'une valeur de départ : le choix fait dans Réglages prime |
| `SUGGESTION_MODEL` | Modèle des appels recettes — suggestions et réécriture (défaut `gemini-3.5-flash-lite`). Distinct de `VISION_MODEL` : lire une étiquette et chercher une recette sur le web n'appellent pas le même modèle. Comme `VISION_MODEL`, c'est une **valeur de départ** : un administrateur peut la remplacer depuis Réglages, et le choix enregistré prime |
| `SUGGESTION_WEB_SEARCH` | `true` ou `false` (**défaut**) : recherche web réelle pour les suggestions. Éteinte par défaut car facturée à la requête, hors quota gratuit : une clé sans facturation la refuse par un 429, et l'écran reste vide au lieu de montrer des recettes web. Valeur de départ seulement — un administrateur bascule l'option depuis Réglages, et son choix prime |
| `VISION_DAILY_QUOTA` | Appels photo autorisés par jour (50) |
| `VISION_MONTHLY_CAP_CENTS` | Plafond de dépense mensuel en centimes, partagé par le scan photo et les suggestions (500, soit 5 €) ; 0 le désactive. Couvre les jetons **et** les requêtes de recherche web |
| `RECIPE_SUGGESTION_DAILY_QUOTA` | Fournées de suggestions de recettes autorisées par jour (20) |
| `RECEIPT_DAILY_QUOTA` | Lectures de ticket de caisse autorisées par jour (10), compteur séparé du scan photo et des suggestions, affiché dans Réglages › Reconnaissance (tuile « Tickets aujourd'hui ») |
| `FALLBACK_MODEL` | Modèle essayé **une seule fois** quand Gemini refuse pour quota épuisé, les quotas étant comptés par modèle. Vide (défaut) : pas de repli, le refus remonte tel quel. Valeur de départ seulement — le choix fait dans Réglages prime |
| `GEMINI_RPD`, `GEMINI_RPM` | Limites de requêtes par jour et par minute du projet Google, telles que `aistudio.google.com/rate-limit` les annonce. **Purement indicatives** : elles ne bloquent rien, elles servent à afficher « 15 / 500 » au lieu de « 15 » dans Réglages. Aucune API ne permet de les lire, d'où la recopie à la main ; laissées vides, l'écran rend le compte seul |
| `OFF_USER_AGENT` | En-tête demandé par Open Food Facts |
| `EXPIRY_ALERT_DAYS` | Seuil d'alerte par défaut (7), modifiable dans les réglages |
| `LOG_LEVEL` | Niveau des journaux JSON sur la sortie standard |

Les journaux ne contiennent jamais de cookie, de jeton Google, de mot de
passe de secours ni de contenu d'image. Chaque appel au fournisseur de vision est journalisé avec sa latence,
son coût estimé et sa confiance ; les compteurs correspondants (appels du jour
et du mois, coût cumulé, taux de reconnaissance automatique sur trente jours,
part des scans résolus par le cache) sont affichés dans les réglages.

## Sécurité

Les garde-fous qui ne se voient pas à l'écran :

- **Pages de recettes web.** Le récupérateur ne lit que du HTTPS vers une
  adresse publique, revalide chaque redirection, et **épingle la connexion sur
  l'adresse qu'il vient de vérifier** : le nom n'est jamais résolu une seconde
  fois, si bien qu'un DNS qui changerait de réponse entre la vérification et
  la connexion (« DNS rebinding ») ne mène pas au réseau local. Sont refusées
  les plages privées, de bouclage, lien-local, multicast, CGNAT, et en IPv6 les
  formes qui encapsulent une IPv4 (`::ffff:…`, `::a.b.c.d`, NAT64
  `64:ff9b::/96`, 6to4 `2002::/16`, Teredo).
- **Photos d'Open Food Facts.** L'adresse de la photo vient de la réponse
  d'Open Food Facts : elle n'est téléchargée qu'en HTTPS depuis
  `images.openfoodfacts.org` ou `static.openfoodfacts.org`, sans suivre de
  redirection, en 8 secondes au plus et 5 Mo au plus (coupée pendant la
  lecture). Toute autre adresse est ignorée et le produit est créé sans photo.
- **En-têtes du navigateur.** Toutes les réponses, front compris, portent une
  politique de sécurité du contenu (scripts et styles de l'application seule,
  plus `accounts.google.com/gsi/` pour le bouton Google ; aucun script en
  ligne ; WebAssembly autorisé pour le décodeur de codes-barres),
  `frame-ancestors 'none'` et `X-Frame-Options: DENY` (aucun affichage dans un
  cadre), une `Permissions-Policy` qui réserve caméra et micro à l'application,
  et `Strict-Transport-Security` dès que `PUBLIC_URL` est en HTTPS. Un reverse
  proxy qui poserait déjà ces en-têtes doit être aligné, sinon le navigateur
  applique les deux politiques à la fois.
- **Écritures inter-origines.** Toute requête qui modifie quelque chose
  (`POST`, `PATCH`, `PUT`, `DELETE`) doit venir de l'origine de `PUBLIC_URL`
  (en-tête `Origin`, à défaut `Referer`) ; sinon 403. Une écriture sans
  aucune de ces deux indications n'est acceptée que si elle ne porte pas de
  cookie de session, et un jeton de service (`Authorization`) sans cookie
  passe toujours. **`PUBLIC_URL` doit donc être exactement l'adresse tapée
  dans le navigateur** (schéma, nom et port) ; en développement, le serveur
  Vite sur `localhost` est accepté en plus.
- **Suggestions : la lecture ne coûte rien.** `GET /api/v1/suggestions` ne
  fait que relire le réservoir (couverture recalculée contre le stock) : il
  n'appelle jamais Gemini et n'écrit rien, `refresh` y est ignoré. La
  recherche qui peut appeler le modèle et consommer le quota est
  `POST /api/v1/suggestions` (orientation dans le corps JSON), celle qu'utilise
  l'écran ; un jeton de service, en lecture seule, ne peut donc pas la
  déclencher.
- **Chaîne de publication.** Les actions GitHub tierces sont épinglées sur un
  SHA de commit complet (la version lisible en commentaire), et le tag de
  version d'une republication manuelle passe par l'environnement puis doit
  avoir la forme `vX.Y.Z` avant toute construction.

## Intégrations

**Home Assistant et autres lecteurs.** Un jeton de service créé dans
Réglages › Jetons de service donne un accès en lecture seule à l'API. Il
appartient au **foyer**, pas à la personne qui l'a créé : il n'est rattaché à
aucun compte, il ne porte aucun rôle, et **révoquer un compte ne l'invalide
pas**. Un jeton se coupe en le supprimant, et seulement ainsi — le supprimer
quand quelqu'un quitte le foyer, comme on change une serrure.

```bash
curl -H "Authorization: Bearer kit_…" https://kitchen.example.org/api/v1/stock/expiring?days=7
```

Toute méthode autre que `GET` est refusée avec ce jeton.

**Ticket de caisse (API ; l'écran est l'onglet Courses, voir Fonctionnalités).**
`POST /api/v1/receipts` (multipart : `file`, photo JPEG, PNG, WebP, HEIC ou PDF
jusqu'à 8 Mo, et `locationId`) fait lire le ticket par Gemini et rend un
**brouillon** : les lignes de produits dans l'ordre d'impression, chacune
rapprochée du catalogue (`MATCHED`, `AMBIGUOUS` ou `UNKNOWN`, avec ses
candidats et la quantité déjà en stock dans l'emplacement). `GET
/api/v1/receipts/:id` le relit (avec son `status`, `DRAFT` ou `VALIDATED`). Rien n'entre au stock à ce stade. Le fichier
n'est jamais conservé et aucun prix n'est stocké ; une quantité lue hors de
0,01 à 99 est ramenée à 1. L'appel compte dans `RECEIPT_DAILY_QUOTA` et dans le
plafond mensuel partagé, y compris quand le ticket est illisible (la lecture
est facturée quand même).

`POST /api/v1/receipts/:id/validate` (`{ "lines": [{ "id", "productId",
"quantity", "clientOpId" }] }`, réponse `{ "added": n }`) fait entrer au stock
les seules lignes envoyées, dans l'emplacement du ticket, sans date de
péremption : chacune est un mouvement d'entrée comme `POST /stock`, donc deux
lignes du même produit s'additionnent. Les lignes absentes du corps ne sont pas
ajoutées et ne créent aucun produit. Le produit d'une ligne doit être le sien :
celui rapproché (`MATCHED`) ou l'un de ses candidats (`AMBIGUOUS`) ; une ligne
`UNKNOWN` ne se valide pas (422, et rien n'entre du lot). Le `clientOpId` rend l'appel rejouable : un
rejeu à l'identique ne double rien (`added: 0`) ; un ticket déjà validé refuse
toute autre demande (409).

Les libellés jamais reconnus s'accumulent pour qu'on les rattache quand on veut :
`GET /api/v1/receipts/pending-labels` rend `[{ "label", "seenAt", "count" }]`
(un libellé n'y figure qu'une fois, même imprimé un peu différemment d'un ticket
à l'autre ; `count` est le nombre de lignes), `GET …/pending-labels/count` rend
`{ "count": n }` pour la pastille de l'onglet Courses, et `POST
…/pending-labels/attach` (`{ "label", "productId" }`, 204) apprend le libellé :
les tickets suivants le reconnaissent, sans passer par la recherche. Rattacher
de nouveau un libellé déjà appris change son produit. Rien ne se fait pendant le
scan ni sur l'écran d'un ticket. Un produit suivi en masse ou en volume reste
proposé comme candidat (`AMBIGUOUS`) plutôt que reconnu d'office ; les unités
qui comptent des objets entiers (pièce, paquet, boîte, sachet) sont reconnues
d'office, le « 3 × » du ticket en désignant trois.

**Export.** `GET /api/v1/export/inventory.csv` et `/inventory.json`, derrière
la session ou un jeton de service. Dans le CSV, une cellule de texte qui
commencerait comme une formule de tableur (`=`, `+`, `-`, `@`, tabulation,
retour chariot) est préfixée d'une apostrophe : Excel l'affiche comme du texte
au lieu de l'exécuter.

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

Le jeu de développement crée le compte `admin@example.org`, `ACTIVE` et
`ADMIN`, si aucun utilisateur n'existe. Il n'a pas de mot de passe : pour
l'utiliser en local, soit renseigner `GOOGLE_CLIENT_ID` et se connecter avec un
compte Google portant cette adresse, soit ouvrir une porte de secours
(`npx tsx tools/acces-secours.ts votre.adresse@example.org`, qui crée ou
réactive ce compte en administrateur).

Construire l'image localement :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### Tests bout en bout

Une suite Playwright (section 19) joue les parcours P1 à P7 dans un vrai
Chromium (caméra simulée depuis une vidéo fabriquée) contre **l'image Docker
réellement construite** — jamais un serveur de développement — démarrée par
un montage jetable dédié (`docker-compose.e2e.yml`) : une base PostgreSQL 16
vide et une doublure locale d'Open Food Facts, de Gemini et des clés de
signature de Google (`e2e/fixtures/stub-server.ts`, qui rejoue les fixtures d'
`apps/api/test/fixtures`). Rien n'est persistant : `down -v` ne laisse rien
derrière lui.

Les parcours se connectent par le chemin réel. Ce qui est doublé, c'est la
**paire de clés** qui signe les jetons Google : la doublure frappe des jetons,
l'application lit ses clés publiques chez elle (`GOOGLE_CERTS_URL`, une
variable qui n'existe que pour ce montage) et les vérifie avec
`google-auth-library` comme en production — signature RS256, émetteur,
audience, expiration. Seul le **widget** de Google est remplacé par un bouton
de test : son script ne peut pas se charger sans réseau. Le rendu du vrai
bouton reste donc la seule partie de la connexion qu'aucun test ne couvre.

Couverture actuelle : P1 (inventaire initial, scans enchaînés), P2 (rangement
des courses, DLC saisie aussi bien directement dans le tiroir de validation
par raccourci qu'après l'ajout depuis le bandeau ; hors lecture automatique
de la date, qui n'existe pas encore), P3
(consommation ; il n'y a plus de bascule en liste de courses, la liste est
abandonnée), P4 (consultation, recherche, filtre par emplacement, périme
bientôt, la vue « à racheter » est abandonnée avec la liste de courses),
P5 (suggestions de recettes, hors cahier des charges, ajouté parce que
c'est la fonctionnalité la plus récente et la plus fragile — y compris le
champ d'ingrédients dictés : pastilles, croix de retrait, autocomplétion
depuis le catalogue, recettes n'utilisant que des combinaisons complètes, et
l'explication affichée quand une combinaison ne rend rien) et P6 (inscription
et validation d'un compte, hors cahier lui aussi : une adresse inconnue se
connecte, voit le message d'attente et n'accède à rien, un administrateur la
valide dans Réglages › Comptes, elle entre) et P7 (ticket de caisse, EF-29 :
on choisit l'emplacement, on dépose la photo, les lignes arrivent dans l'ordre
du ticket, on en décoche une, on valide, et la quantité du produit coché monte
dans le Stock, celle du produit décoché ne bouge pas ; Gemini est doublé, le
reste est le code réel). Le mode hors
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
local, faute de moteur de conteneurs sur le Mac de djkix. C'est le
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
Google Identity Services (flux « jeton d'identité », vérifié côté serveur
par `google-auth-library`) pour la connexion, Argon2id pour le seul mot de
passe qui subsiste, celui de la porte de secours ; Vitest pour les tests. Une seule image
Docker sert l'API et le front compilé ; l'intégration continue GitHub Actions
vérifie types, lint, tests, cohérence des migrations, puis publie l'image
`amd64` sur GitHub Container Registry à chaque version taguée par
release-please.

## Derniers changements

Une ligne par version ; le détail complet est dans [CHANGELOG.md](CHANGELOG.md),
engendré par release-please depuis les messages de commit.

| Version | Date | Changement |
| --- | --- | --- |
| 0.30.0 | 2026-10-22 | Le ticket de caisse remplit le stock, et la liste de courses est abandonnée |
| 0.29.1 | 2026-10-22 | `docker-compose.yml` et `.env.example` transmettent enfin `FALLBACK_MODEL`, `GEMINI_RPD` et `GEMINI_RPM` : les trois variables ajoutées la veille existaient côté application mais n'étaient pas… |
| 0.29.0 | 2026-10-22 | Réglages : tout replié, puces de couleur, version en haut à droite, et la conso des recettes enfin visible |
| 0.28.0 | 2026-10-21 | Dire quelle limite Gemini refuse, et basculer de modèle plutôt que d'abandonner |
| 0.28.0 | 2026-10-21 | Réglages en sections pliables, chaque en-tête portant son résumé |
| 0.27.1 | 2026-10-21 | Correctif : depuis le 15 octobre, aucun appel à Gemini n'était chiffré et le plafond mensuel de 5 € comptait zéro |
| 0.27.0 | 2026-10-21 | Demande parlée : on dicte ce qu'on a et ce qu'on veut, Gemini écoute et propose |
| 0.27.0 | 2026-10-20 | Le défilement de Suggestions finissait par demander plus de recettes que le schéma partagé n'en autorise : le serveur répondait « corps de requête invalide », et le bouton « Réessayer » de l'écran… |
| 0.27.0 | 2026-10-20 | Le défilement infini de Suggestions ne chargeait qu'une seule page de plus, puis s'arrêtait : l'observateur se débranchait après son premier déclenchement et ne se rebranchait jamais |
| 0.27.0 | 2026-10-20 | Sur Suggestions, le bouton « Charger plus » n'est plus affiché : le défilement infini charge la suite tout seul, et le bouton restait pourtant visible en permanence tant qu'il restait des pages |
| 0.26.0 | 2026-10-20 | La fiche recette perd le nom de la cuisine en tête et le titre « Ingrédients » au-dessus de la liste, pour gagner deux lignes : une liste d'ingrédients se reconnaît sans qu'on la nomme |
| 0.25.0 | 2026-10-20 | Sur la fiche recette, le nombre de parts prend le même gabarit que les durées — étiquette « Parts » au-dessus, valeur en dessous, alignée sur la même ligne de base — au lieu d'un champ habillé… |
| 0.24.0 | 2026-10-20 | La fiche recette passe en lecture seule, les informations utiles remontées en tête |
| 0.23.0 | 2026-10-20 | L'écran Suggestions reprend l'affichage de « Mes recettes » : les quatre sélecteurs d'orientation (type de plat, cuisine, durée, facilité), qui occupaient en permanence une moitié d'écran de… |
| 0.22.0 | 2026-10-19 | « Mes recettes » et la fiche recette reprises pour le téléphone, où l'application est utilisée en très grande majorité |
| 0.21.0 | 2026-10-19 | Le champ d'ingrédients de l'écran Suggestions passe aux pastilles et s'accompagne d'une autocomplétion depuis votre catalogue de produits |
| 0.20.0 | 2026-10-19 | Les suggestions partent désormais aussi des ingrédients que vous dictez : un champ de texte libre, au-dessus des filtres de l'écran Suggestions, où l'on tape « pommes de terre, merguez » (cinq… |
| 0.19.0 | 2026-10-19 | Tout le réservoir de recettes se parcourt enfin : sous la liste des suggestions, un bouton « Charger plus (12 sur 37) » — même geste et même formulation que « Mes recettes » — allonge la page de… |
| 0.18.0 | 2026-10-18 | Connexion par compte Google, et plus de mot de passe nulle part dans l'interface (section 10) |
| 0.17.0 | 2026-10-15 | Le menu de choix des modèles, dans Réglages › Reconnaissance, se limite désormais à la famille Flash : l'API Gemini ne dépend pas de l'abonnement Google AI Plus et servirait un modèle Pro sans… |
| 0.16.0 | 2026-10-11 | Parcours dirigé des suggestions sur mobile (EF-25) |
| 0.15.0 | 2026-10-08 | Favoris et note directe sur une recette (EF-21) |
| 0.14.0 | 2026-10-08 | Lot recettes « complétude et usage » : couverture, groupes et historique de réalisation |
| 0.13.0 | 2026-10-08 | Les suggestions sont classées par type de plat — entrée, plat, dessert, accompagnement, apéritif, petit-déjeuner, boisson — sur la taxonomie qui existait déjà pour « Mes recettes », et qu'une… |
| 0.12.3 | 2026-10-08 | La liste des modèles proposée dans Réglages se limite à la ligne courante de Gemini |
| 0.12.2 | 2026-10-07 | Nettoyage après audit d'over-engineering : suppression des adaptateurs Anthropic, OpenAI et Ollama, jamais configurés ni exercés hors de leurs propres tests, et de la dépendance… |
| 0.12.1 | 2026-10-07 | Retrait de `temperature` des trois appels Gemini (reconnaissance photo, suggestions, réécriture) |
| 0.12.0 | 2026-10-07 | Interrupteur « Recherche web des recettes » dans Réglages › Reconnaissance, pour les administrateurs |
| 0.11.0 | 2026-10-06 | Les administrateurs choisissent les modèles depuis Réglages, section Reconnaissance : une ligne pour la photo, une pour les recettes |
| 0.10.0 | 2026-10-06 | Le numéro de version ne s'affiche plus qu'au bas de l'écran Réglages, au lieu de chaque écran et de la page de connexion : c'est une information d'administration, et le bandeau « Nouvelle version… |
| 0.9.2 | 2026-10-05 | Correctif : aucune suggestion de recette n'avait jamais abouti depuis la 0.8.0 |
| 0.9.1 | 2026-10-05 | Correctif d'accessibilité : les cartes de recette et de suggestion n'avaient aucun nom annoncé par les lecteurs d'écran, et étaient introuvables par une requête rôle + nom — Chromium ne remonte… |
| 0.9.0 | 2026-10-05 | La date de péremption se saisit désormais directement dans le tiroir de validation du scan (EF-02), ce que djkix avait demandé puis fait reporter deux fois : sous la quantité, trois raccourcis («… |
| 0.8.3 | 2026-10-05 | Tests des parcours de bout en bout : vingt-huit scénarios rejouent désormais l'application entière dans un vrai navigateur — ranger les courses en scannant, saisir une date de péremption,… |
| 0.8.2 | 2026-10-05 | Correctif : la recherche du stock ignore désormais les accents (EF-11) |
| 0.8.1 | 2026-10-05 | Correctif : « Mes recettes » n'affichait jamais une recette conservée |
| 0.8.0 | 2026-10-04 | Recettes suggérées à partir du stock (EF-26) : écran Suggestions en entrée du module, point de départ composé depuis le stock réel, recherche web et composition par Gemini, orientation par… |
| 0.7.0 | 2026-10-04 | Module recettes (socle) : écran Recettes trié par note avec filtres et tris mémorisés (EF-21, EF-22, EF-23) ; fiche recette avec état de chaque ingrédient et historique noté par membre (EF-23,… |
| 0.6.1 | 2026-10-03 | Publication : « latest » ne suit plus que les versions publiées, les poussées sur main vont sous « main » |
| 0.6.0 | 2026-10-03 | Bandeau de mise à jour : nouvelle version détectée et rechargement proposé, sans interrompre un scan |
| 0.5.0 | 2026-09-21 | Version affichée au bas de chaque écran, alerte quand l'interface en cache est périmée ; publication de l'image limitée à amd64, l'architecture de l'hôte |
| 0.4.0 | 2026-09-21 | Photo prise par l'appareil natif du téléphone, plafond de dépense mensuel en euros |
| 0.3.0 | 2026-09-21 | Scan : validation du produit et de la quantité avant ajout ; fin des ajouts répétés du même article |
| 0.2.2 | 2026-09-21 | Déploiement : droits du volume `media` ajustés au démarrage, plus de `chown` manuel |
| 0.2.1 | 2026-09-21 | Configuration : les variables vides transmises par Compose (`VISION_BASE_URL=`) sont ignorées au lieu de bloquer le démarrage |
| 0.2.0 | 2026-09-21 | Reconnaissance photo : fournisseur Google Gemini (`gemini-3.5-flash`), retenu par défaut ; port hôte 8888 |
| 0.1.0 | 2026-09-21 | Lot 1 : authentification, emplacements, produits, stock et mouvements, scan code-barres, Open Food Facts, vision, export, PWA mobile, stack Docker |
## Licence

MIT, voir `LICENSE`.
