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
  comprises.
- Stack Docker et variables d'environnement.

## Prochaine étape

Étape 1, le socle : monorepo, migrations, authentification par comptes locaux
(session cookie httpOnly, mots de passe Argon2id), healthcheck, stack qui
démarre. Rien de visible côté utilisateur.

Ne commence pas les écrans avant que `docker compose up` donne une API qui
répond sur `/api/v1/health`.
