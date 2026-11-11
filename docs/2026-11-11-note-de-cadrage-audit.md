# Note de cadrage — audit de sécurité de kitchen-inventory

**Version auditée :** 0.42.0 (étiquette `v0.42.0`, commit `6d14332`).
**Date de remise :** 2026-11-11.
**Destinataire :** l'auditeur externe.

Cette note sert à ne pas vous faire perdre de temps. Elle dit ce qu'est
l'application, comment elle est exploitée, ce qui a déjà été revu, et où nous
pensons que le risque se trouve. Rien ici n'est une limite à ce que vous
regardez : si notre lecture du risque est fausse, le dire est précisément ce
que nous attendons de l'audit.

---

## 1. Ce qu'est l'application

Inventaire alimentaire familial, auto-hébergé. On photographie un produit ou un
ticket de caisse depuis le téléphone, l'application reconnaît ce qui a été
acheté, suit les dates de péremption et propose des recettes à partir du stock
réellement présent.

Environ 47 000 lignes de TypeScript, 657 fichiers.

**Contexte d'exploitation, qui compte pour le modèle de menace :**

- Un seul déploiement, sur un mini-PC Debian à la maison, derrière un reverse
  proxy (Nginx Proxy Manager) qui termine le TLS.
- **Le service est exposé sur l'Internet public**, à `kitchen.djkix.ovh` :
  l'accès caméra depuis un téléphone exige HTTPS, et les utilisateurs ne sont
  pas tous sur le réseau local. Tout ce qui est joignable l'est donc par
  n'importe qui ; seule l'authentification sépare l'anonyme du membre.
- Les utilisateurs sont une poignée de membres d'un foyer, tous connus. Il n'y
  a pas de multi-tenant : une seule base, un seul foyer, pas de cloisonnement
  de données entre utilisateurs à vérifier.
- Les données sont d'une sensibilité faible en elles-mêmes (ce qu'il y a dans
  les placards), mais la base contient des adresses e-mail Google et des
  identifiants de compte Google (`googleSub`), et les sauvegardes contiennent
  la configuration en clair (voir §4).

## 2. Pile et points d'entrée

| Couche | Technologie |
|---|---|
| API | NestJS, Prisma, PostgreSQL 16 |
| Interface | React + Vite, PWA installable |
| Règles métier | `packages/shared`, fonctions pures testées |
| Validation | Zod, schémas définis une seule fois et partagés |
| Déploiement | image Docker unique, `docker compose`, trois services |

Les dépendances d'exécution tiennent en peu de chose — côté API :
`@nestjs/*`, `@prisma/client`, `google-auth-library`, `@node-rs/argon2`,
`web-push`, `zod`, `pino`, `cookie-parser`, `@nestjs/throttler` ; côté
interface : `react`, `react-router`, `@tanstack/react-query`,
`react-hook-form`, `zod`, `zxing-wasm`.

**Points d'entrée à regarder en premier :**

- `apps/api/src/main.ts` et `app.ts` — amorçage, middlewares, ordre de la chaîne.
- `apps/api/src/common/` — filtre d'erreurs, en-têtes de sécurité
  (`noindex.middleware.ts`), garde des écritures inter-origines
  (`csrf.middleware.ts`), client HTTP sortant (`http-client.ts`), pipe de
  validation Zod.
- `apps/api/src/auth/` — sessions, vérification du jeton Google, porte de
  secours, garde de session.
- Un dossier par domaine métier sous `apps/api/src/` : `stock`, `recipes`,
  `suggestions`, `receipts`, `recognition`, `accounts`, `backup`, `export`,
  `media`, `notifications`, `service-tokens`.

## 3. Ce qui a déjà été revu — inutile de repayer ce terrain

Une revue de sécurité a eu lieu le **2026-10-22** et ses corrections sont dans
le code que vous recevez. Signalez bien sûr tout ce qui vous paraît mal
corrigé, mais ces sujets ne sont plus des découvertes :

- Premier administrateur sur une base vide réservé à `ADMIN_EMAIL` ; sans
  cette variable, aucune connexion Google ne crée d'administrateur en
  production (la porte de secours est alors le seul chemin).
- Récupérateur de pages web épinglé sur l'adresse IP validée
  (`pinnedAddress`, `common/http-client.ts`) pour fermer le TOCTOU du
  DNS rebinding, refus des adresses privées, refus IPv6 étendu — défense SSRF.
- Photos Open Food Facts bornées : liste d'hôtes, HTTPS obligatoire, 5 Mo,
  aucune redirection suivie.
- En-têtes CSP, X-Frame-Options, Permissions-Policy, HSTS.
- Garde des écritures inter-origines : toute écriture doit porter un `Origin`
  égal à `PUBLIC_URL`.
- `GET /suggestions` rendu strictement en lecture seule, la recherche passée
  en `POST /suggestions`.
- Export CSV protégé contre l'injection de formules.
- Actions GitHub de la CI épinglées par SHA.

Une seconde revue, le **2026-10-18**, portait sur la connexion Google et a
produit un amendement (D10) intégré. Son compte rendu est dans
`docs/specs/2026-10-18-connexion-google.md`.

## 4. Points d'attention que nous désignons nous-mêmes

Par ordre de gêne décroissante, de notre point de vue.

**La porte de secours (`tools/acces-secours.ts`).** C'est le seul reste de mot
de passe dans toute l'application. Elle se lance dans le conteneur
(`docker compose exec app node tools/acces-secours.js <adresse>`), affiche un
mot de passe Argon2id une seule fois, valable une heure, à usage unique, et
`POST /auth/recovery` est le seul point d'entrée qui l'accepte. C'est par
construction le chemin le plus intéressant pour un attaquant : il contourne
Google. Nous aimerions votre lecture du minutage, de l'unicité d'usage, de la
limitation de débit et de ce que le point d'entrée révèle en cas d'échec.

**L'authentification, de bout en bout.** Flux « jeton d'identité » Google : le
jeton est vérifié côté serveur par `google-auth-library` (signature, émetteur,
expiration, audience). Une adresse inconnue crée une demande `PENDING` sans
ouvrir de session ; `PENDING` et `REVOKED` rendent délibérément la même
réponse ; une discordance de `googleSub` sur une adresse connue est un refus ;
le statut du compte est revérifié **à chaque requête**
(`SessionService.authenticate`). Points à éprouver : la gestion du cookie de
session, l'invalidation, la fixation, et la création du premier administrateur
sous `LOCK TABLE … SHARE ROW EXCLUSIVE`.

**`GOOGLE_CERTS_URL`.** Variable réservée aux tests bout en bout : elle
remplace la source des clés publiques qui valident les jetons Google. Posée en
production, elle déplace la racine de confiance de toute l'authentification.
L'application avertit au démarrage et la signale dans `/health`, mais ne
refuse pas de démarrer. Dites-nous si cet avertissement vous paraît suffisant.

**Les quatre chemins qui envoient des données de l'utilisateur à Google
Gemini :** reconnaissance photo (`recognition/providers/gemini.provider.ts`),
lecture de ticket (`receipts/gemini-receipt.reader.ts`), suggestions de
recettes (`suggestions/gemini-suggestion.provider.ts`), réécriture de page web
(`suggestions/gemini-recipe-rewriter.ts`), tous passant par
`gemini/gemini.service.ts`. À regarder : ce qui sort réellement, le traitement
d'une réponse hostile (le `responseSchema` a été retiré, le JSON vient
désormais de la consigne seule), et la demande parlée
(`POST /suggestions/voice`, multipart, 60 s et 4 Mo).

**Les téléversements.** Photos de produits, photos et PDF de tickets (8 Mo),
audio de la demande parlée. Stockage, nommage, type MIME, et ce que le
service de médias accepte de servir en retour.

**Les sauvegardes.** Le service `backup` écrit chaque jour sur un partage NFS
du NAS un dossier daté contenant la base, les médias et **la configuration de
la stack, `.env` compris, en clair** — donc la clé Gemini, le secret de
session, le mot de passe PostgreSQL et la clé privée VAPID. Sept jours
conservés. C'est assumé (il faut pouvoir restaurer), mais c'est l'endroit où
la compromission du NAS devient la compromission de tout. Votre avis sur ce
compromis nous intéresse.

**Les jetons de service** (`service-tokens/`). Stockés hachés, rendus en clair
une seule fois à la création. À quoi ils donnent droit et comment ils sont
présentés mérite un regard.

**Le flux de ticket de caisse** (`receipts/`, `matchReceiptLine` dans
`packages/shared`), parce que c'est la fonctionnalité la plus récente et que
chaque ligne reconnue finit par écrire un mouvement de stock.

## 5. Deux invariants métier dont la violation est un bug de sécurité

Ils ne ressemblent pas à des sujets de sécurité mais la corruption des données
en dépend :

1. `StockItem.quantity` est une valeur **matérialisée**. La vérité est la somme
   des `StockMovement`. Une consommation insère un mouvement puis recalcule ;
   rien ne doit jamais écrire la quantité directement. Tout chemin qui le fait
   est un défaut, même s'il n'est pas exploitable à distance.
2. Toute écriture porte un `clientOpId` unique et la synchronisation rejoue des
   deltas additifs, jamais des quantités absolues. L'idempotence en dépend.

## 6. Hors périmètre

- Le reverse proxy, le certificat TLS et la configuration DNS : ils ne sont pas
  dans le dépôt.
- Le NAS et son partage NFS, au-delà de ce que l'application y écrit.
- Les valeurs réelles des secrets : aucune n'est dans l'archive. Le seul
  fichier d'environnement versionné est `.env.example`, qui ne contient que des
  noms de variables, des valeurs factices et leur documentation. Lisez-le, il
  décrit tout ce que l'application attend.
- `docs/superpowers/` : artefacts d'outillage de développement, sans rapport
  avec le produit.

## 7. Pour lire et faire tourner le code

Ni Docker ni PostgreSQL ne sont nécessaires pour les tests : `npm test` démarre
une base PostgreSQL 16 embarquée. Compiler d'abord le paquet partagé si ce
n'est jamais fait : `npm run build -w @kitchen/shared`. Le README décrit
l'installation complète, section Développement.

**Aucun test ne touche au réseau** : les réponses d'Open Food Facts et de
Gemini sont rejouées depuis des fixtures. Les parcours bout en bout Playwright
(`e2e/p1` à `e2e/p7`) tournent au navigateur contre l'image Docker et une base
jetable, avec des doublures locales ; ils ne s'exécutent qu'en CI.

**Les documents à lire avec le code**, sans quoi des décisions assumées
ressembleront à des anomalies :

- `docs/cahier-des-charges.md` fait autorité ; sa section 25 tranche les
  contradictions, sa section 26 porte les amendements datés.
- `docs/specs/` : une note par fonctionnalité, avec les arbitrages et leurs
  raisons.
- `docs/decisions/` : les choix laissés au jugement par le cahier des charges.

## 8. Ce que nous attendons en retour

Des défauts exploitables, classés par gravité réelle dans **ce** contexte
d'exploitation — un foyer, pas une banque. Un défaut théorique qu'aucun chemin
n'atteint nous intéresse moins qu'un défaut modeste réellement joignable depuis
l'Internet public.

Nous attendons aussi, explicitement : si l'un des compromis assumés ci-dessus
(sauvegarde du `.env` en clair, avertissement non bloquant sur
`GOOGLE_CERTS_URL`, porte de secours par mot de passe) vous paraît
indéfendable, dites-le. C'est le genre de verdict qu'on ne peut pas se rendre
à soi-même.
