# Consignes du projet

Application web auto-hébergée d'inventaire alimentaire : scan photo depuis le
téléphone, suivi des péremptions, suggestions de recettes à partir du stock réel.

## Le document de référence

`docs/cahier-des-charges.md` fait autorité. Il est normatif sauf la section 23
(évaluation à mener). Avant d'écrire du code sur un sujet, lis la section
correspondante — la table des matières est en tête de fichier.

Les exigences sont numérotées EF-01 à EF-28. Cite-les dans les commits et les
tests : `feat(scan): cascade de reconnaissance (EF-03)`.

En cas de contradiction entre deux sections, la section 25 (décisions arrêtées)
tranche. Ce qui n'est pas spécifié est laissé au jugement : le signaler dans la
réponse plutôt que l'inventer silencieusement.

## Pile technique

TypeScript de bout en bout. NestJS + Prisma + PostgreSQL 16 côté API, React +
Vite + Tailwind côté PWA, types partagés dans `packages/shared`. Déploiement par
`docker compose`, derrière un reverse proxy qui termine le TLS.

## Structure imposée

Voir section 18 du cahier des charges. Elle n'est pas indicative : ne réorganise
pas l'arborescence.

```
apps/api/          NestJS, un dossier par domaine
apps/web/          React + Vite, un dossier par écran (section 14)
packages/shared/   types, schémas Zod, unités, constantes
prisma/            schema.prisma + migrations
docker/            Dockerfile, entrypoint
docs/              cahier des charges, décisions
tools/             utilitaires hors application
```

## Règles non négociables

- Chaque évolution (fonctionnalité, correctif, changement de déploiement) met à
  jour `README.md`, en français, dans le même commit : installation,
  configuration, fonctionnalités décrites telles qu'elles sont réellement.
- Chaque version a une entrée de changelog : `CHANGELOG.md` est généré par
  release-please depuis les messages de commit (en français), et la section
  « Derniers changements » du README reprend une ligne par version
  (`| Version | Date | Changement |`, la plus récente en tête) avec un lien
  vers `CHANGELOG.md`. Ajouter la ligne au moment de la modification, sans
  attendre qu'on le demande.

- `StockItem.quantity` est une valeur matérialisée. La vérité est la somme des
  `StockMovement`. Une consommation insère un mouvement puis recalcule ; elle
  n'écrit jamais la quantité directement.
- La synchronisation hors ligne rejoue des deltas additifs, jamais des quantités
  absolues. Chaque opération porte un `clientOpId` unique pour l'idempotence.
- Les règles métier de la section 15 vivent dans des fonctions pures testées,
  dans `packages/shared`. Jamais recopiées dans un composant ou un contrôleur.
- Anglais pour le code et les identifiants, français pour les libellés
  d'interface et les messages d'erreur.
- TypeScript strict, `any` interdit hors tests.
- Validation des entrées par Zod, schémas définis une seule fois dans
  `packages/shared` et réutilisés côté front.
- Aucune modification de schéma sans migration Prisma versionnée et commitée.
- Aucun test ne dépend du réseau : réponses d'Open Food Facts et du fournisseur
  de vision rejouées depuis des fixtures.

## Ce qui est déjà fait

- Étape 0 validée : accès caméra en HTTPS confirmé, reconnaissance de
  code-barres rapide sur mobile. Page de test dans `tools/test-scan.html`.
- Schéma de données complet dans `prisma/schema.prisma`, entités recettes
  comprises, migration initiale commitée.
- Lot 1 livré : `packages/shared` (unités, règles métier, schémas Zod),
  `apps/api` (auth par sessions, emplacements, produits, stock et mouvements,
  cascade de reconnaissance (fournisseur `gemini`, seul implémenté),
  export, healthcheck), `apps/web` (PWA : installation, connexion, stock,
  fiche article, périme bientôt, scan en rafale, réglages).
- Livraison : image Docker unique `linux/amd64` sur GHCR (l'hôte est un
  mini-PC x86), `docker-compose.yml` à trois services, CI GitHub Actions
  (types, lint, tests sur PostgreSQL 16, dérive des migrations, build
  d'image), release-please. L'étiquette `latest` ne suit que les versions
  publiées ; les poussées sur `main` sortent sous l'étiquette `main`.
- En service chez djkix depuis la 0.6.1 : scan validé article par article,
  photo par l'appareil natif, version affichée et bandeau de mise à jour.
- Module recettes (socle) livré : `apps/api/src/recipes` (CRUD, filtres et tri
  mémorisés, couverture et groupe calculés depuis le stock, cuisson avec
  décrément plafonné et choix du produit substitué, réalisation sans
  décrément, historique et notation par membre sous sept jours, archivage),
  migration `0003_recipes_socle` et jeu de développement (8 recettes, 5
  cuisines, historique de réalisations). Spécification et 27 arbitrages dans
  `docs/specs/2026-10-03-module-recettes-socle.md`.
- Recettes suggérées à partir du stock livrées (EF-25, EF-26) :
  `apps/api/src/suggestions` (composition du point de départ depuis le stock,
  appel à Gemini avec recherche web et composition par le modèle, orientation
  par région/durée/facilité relançant une recherche ciblée, cache de fournée
  24 h, quota journalier et plafond mensuel partagés avec le scan photo,
  rapprochement des ingrédients au stock, conservation d'une suggestion —
  page récupérée et réécrite par Gemini au format de l'application, jamais de
  renvoi vers le site), `apps/web/src/screens/suggestions` (écran Suggestions,
  désormais écran d'entrée du module recettes), `apps/web/src/screens/recipes`
  (devenu « Mes recettes », bouton de création retiré) et `recipe-form`
  (formulaire de modification seule, la création manuelle a disparu),
  migrations `0005_recipe_suggestions` et `0006_recipe_client_op_id`.
  `VISION_MONTHLY_CAP_CENTS` plafonne désormais l'ensemble des appels au
  modèle (scan et suggestions), porté à 5 € ; `RECIPE_SUGGESTION_DAILY_QUOTA`
  borne les fournées par jour. Spécification et dix-sept arbitrages dans
  `docs/specs/2026-10-04-recettes-suggerees.md` ; cahier des charges amendé le
  2026-10-04 (section 26). EF-24 (ajout aux courses, qui suppose une liste de
  courses qui n'existe pas encore) en reste hors, remonté au lot 2.
- Réservoir permanent de suggestions livré (EF-25, EF-26) : le cache de fournée
  de 24 h n'existe plus. Les recettes rapportées par le modèle entrent dans
  `SuggestionPoolRecipe` (migration `0009_suggestion_pool`), dédoublonnées par
  `suggestionIdentity`, sans limite d'âge ; la couverture est recalculée contre
  le stock à chaque visite. Le modèle n'est appelé que sous un plancher de six
  recettes pour l'orientation demandée ou sur relance explicite, et la signature
  de recherche ne contient plus les graines — elle ne dépend donc plus du stock.
  Une recette `web` n'est retenue que si `RecipePageFetcher` a pu lire sa page ;
  le contenu est recopié dans la ligne et **le site n'est plus jamais
  recontacté**, pas même à la conservation, qui réécrit à partir de ce contenu.
  Spécification et onze décisions dans
  `docs/specs/2026-10-15-reservoir-de-suggestions.md` ; cahier des charges
  amendé le 2026-10-15 (section 26).
- Demande parlée livrée (EF-25, EF-26) : `POST /suggestions/voice`
  (multipart, champ `audio`), un seul appel à Gemini qui rend la lecture
  (`heard`) **et** les recettes, écran `apps/web/src/screens/suggestions/
  voice-request-screen.tsx` atteint par une icône de micro dans l'en-tête de
  Suggestions (le champ à pastilles est inchangé). L'audio n'est conservé
  nulle part ; l'enregistrement est borné à 60 s et 4 Mo
  (`voiceAudioRejection`, règle partagée appliquée à l'écran et au serveur) ;
  l'appel consomme le quota journalier et le plafond mensuel, et les recettes
  entrent au réservoir. `PRICES_USD_PER_MTOK` porte désormais un tarif
  `audio` et `estimateCostCents` facture tout au tarif audio quand l'API ne
  ventile pas les jetons par modalité. Aucune migration. Spécification et
  neuf décisions dans `docs/specs/2026-10-21-demande-parlee.md`.
- Les choix laissés au jugement par le cahier des charges sont consignés dans
  `docs/decisions/`. Le plan d'exécution du lot 1 est dans `docs/plans/`.
- Tests bout en bout Playwright livrés (section 19) : les parcours P1 à P4 du
  cahier (section 3, chacun limité à ce que l'application sait faire
  aujourd'hui) et un parcours P5 Suggestions ajouté hors cahier parce que
  c'est la fonctionnalité la plus récente et la plus fragile. Joués au
  navigateur (Chromium, caméra simulée) contre l'image Docker construite dans
  le job lui-même et une base PostgreSQL jetable, avec une doublure locale
  d'Open Food Facts et de Gemini — jamais de réseau réel. **CI uniquement**,
  sur `main` après fusion : djkix n'a pas de moteur de conteneurs sur son
  Mac. La conservation d'une recette trouvée sur le web n'est pas jouée bout
  en bout : le récupérateur de pages refuse HTTP et les adresses privées, et
  une doublure locale tombe dans les deux cas. Spécification, quinze
  décisions et les deux limites assumées dans
  `docs/specs/2026-10-04-tests-bout-en-bout.md` et
  `docs/decisions/2026-10-04-tests-bout-en-bout.md`.
- Connexion par compte Google livrée (section 10, spec
  `docs/specs/2026-10-18-connexion-google.md`, D1 à D9 et amendement D10 issu
  de la revue de sécurité) : flux « jeton d'identité », `GOOGLE_CLIENT_ID`
  public servi à l'exécution par `GET /auth/google/client-id`, jeton vérifié
  côté serveur par `google-auth-library` (signature, émetteur, expiration,
  audience). **Plus aucun mot de passe dans l'interface** : `POST /auth/login`,
  `POST /auth/setup`, `POST /me/password` et `POST /users` ont disparu, avec
  l'écran d'installation, l'écran Utilisateurs et le verrouillage après cinq
  échecs. Une adresse inconnue crée une demande `PENDING` sans ouvrir de
  session ; un administrateur valide dans **Réglages › Comptes**
  (`apps/web/src/screens/settings/accounts-section.tsx`, quatre listes : en
  attente, actifs, refusés avec « Rétablir », son propre compte), servie par
  `apps/api/src/accounts`. `PENDING` et `REVOKED` rendent la même réponse ; une
  discordance de `googleSub` sur une adresse connue est un refus ; le statut
  est vérifié **à chaque requête** (`SessionService.authenticate`). Sur une
  base vide, la première connexion Google crée l'administrateur et les
  emplacements par défaut, sous `LOCK TABLE … SHARE ROW EXCLUSIVE`. Porte de
  secours : `tools/acces-secours.ts`, lancée dans le conteneur
  (`docker compose exec app node tools/acces-secours.js adresse@example.org`),
  mot de passe Argon2id affiché une seule fois, une heure, un seul usage, sur
  `POST /auth/recovery` — seul reste du mot de passe. Migrations
  `0011_connexion_google` et `0012_acces_secours` ; cahier des charges amendé
  le 2026-10-18 (sections 10, 14, 16, 19 et 26). Parcours bout en bout P6
  (`e2e/p6-comptes.spec.ts`) : les clés de signature de Google sont doublées
  par `e2e/fixtures/stub-server.ts` (`GOOGLE_CERTS_URL`), la vérification reste
  celle de production, seul le widget Google est remplacé. Le job `build-image`
  de la CI lance la commande de secours dans l'image fraîchement construite.
- Saisie de la DLC directement dans le tiroir de validation du scan livrée
  (EF-02, section 3, P2) : sous la quantité, trois raccourcis (« +3 j »,
  « +1 sem », « +1 mois », calculés par `expiryShortcutDate` dans
  `packages/shared`, en jour civil local) et un lien « autre date » pour la
  date libre avec le choix DLC/DDM. Rien n'est obligatoire : valider sans
  toucher à la date reste le même geste qu'avant. Le bouton « + DLC » du
  bandeau du dernier article reste disponible pour rattraper un oubli après
  coup — les deux chemins sont couverts par des parcours bout en bout.

## Développement local

Ni Docker ni PostgreSQL ne sont requis pour les tests : `npm test` démarre une
base PostgreSQL 16 embarquée. `npm run build -w @kitchen/shared` d'abord si le
paquet partagé n'a jamais été compilé. Voir le README, section Développement.

## Prochaine étape

Lot 2 (décision 8) après quelques semaines d'usage réel : seuils et liste de
courses, alertes de péremption, mode hors ligne (`POST /sync`, file IndexedDB,
les écritures portent déjà `clientOpId`), export enrichi, et pour le module
recettes : ajout des ingrédients manquants aux courses (EF-24, qui suppose
cette liste). Reste aussi à écrire le jeu de non-régression de reconnaissance
sur photos réelles (section 19).
