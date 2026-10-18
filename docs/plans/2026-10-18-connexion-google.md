# Connexion par compte Google — plan d'exécution

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — `superpowers:subagent-driven-development`.

**Objectif :** se connecter et s'inscrire par compte Google, sans mot de passe,
avec validation d'un administrateur avant tout accès.

**Architecture :** flux « jeton d'identité » de Google Identity Services (pas de
redirection, pas de client secret). Le serveur vérifie le jeton, retrouve le
compte **par adresse e-mail**, et n'ouvre la session existante de Kitchen que si
le compte est `ACTIVE`. Une adresse inconnue crée un compte `PENDING`, sans
session. Les mots de passe disparaissent de l'interface ; une commande serveur
reste comme porte de secours.

**Pile :** NestJS 12, Prisma 6, PostgreSQL 16, Zod 4, React 19, Vite.

**Spec :** `docs/specs/2026-10-18-connexion-google.md` — lire D1 à D9 et la
section « Le mécanisme repris de magazine-search » avant de commencer.

## Contraintes globales

- Français pour les libellés d'interface, les messages d'erreur et les
  commentaires ; anglais pour le code et les identifiants.
- TypeScript strict, `any` interdit hors tests.
- Schémas Zod définis une seule fois dans `packages/shared`, réutilisés côté front.
- Aucune modification de schéma sans migration Prisma versionnée.
- Aucun test ne dépend du réseau : la vérification du jeton Google est doublée.
- Chaque évolution met à jour `README.md` — porté par la tâche 8, pas par chaque tâche.
- **Chemin de sécurité : on ne simplifie rien.** La validation du compte se
  vérifie côté serveur à chaque connexion, jamais seulement à l'affichage.

## Points de vigilance

1. Un jeton valide pour une adresse `PENDING` ne doit ouvrir **aucune** session,
   et le message doit dire que la demande attend une validation (tâche 3).
2. Un jeton dont `email_verified` est faux est refusé, même signé (tâche 3).
3. Un compte `REVOKED` est refusé, et ses sessions en cours sont coupées au
   moment de la révocation (tâches 3 et 4).
4. Sur une base vide, deux connexions simultanées ne créent qu'un seul
   administrateur (tâche 3).
5. Un jeton dont l'audience n'est pas le `GOOGLE_CLIENT_ID` configuré est
   refusé — c'est la protection contre un jeton émis pour une autre
   application (tâche 3).

---

### Tâche 1 : Schémas partagés et états de compte

**Fichiers :**
- Modifier : `packages/shared/src/schemas/auth.ts` (ou le fichier qui porte déjà `LoginInput`, `CurrentUser`, `SetupInput` — le localiser d'abord)
- Modifier : `packages/shared/src/index.ts` si besoin
- Test : à côté du schéma modifié

**Interfaces produites**, consommées par toutes les tâches suivantes :

```ts
export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'REVOKED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS_FR: Record<AccountStatus, string> = {
  PENDING: 'En attente',
  ACTIVE: 'Actif',
  REVOKED: 'Refusé',
};

/** Corps de `POST /auth/google`. Le nom `credential` est imposé par le callback GSI. */
export const googleLoginSchema = z.object({
  credential: z.string().trim().min(1, { message: 'Jeton Google requis' }),
});
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;

/** Une ligne de Réglages › Comptes. */
export interface AccountDto {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  status: AccountStatus;
  createdAt: string;
}
```

- [ ] **Étape 1 : écrire les tests qui échouent** — `googleLoginSchema` refuse une chaîne vide et accepte un jeton quelconque non vide ; `ACCOUNT_STATUS_LABELS_FR` couvre les trois états.
- [ ] **Étape 2 : lancer, constater l'échec.**
- [ ] **Étape 3 : implémenter** ; retirer `LoginInput`, `SetupInput` et `ChangePasswordInput` s'ils n'ont plus d'appelant après la tâche 3 — sinon les laisser à la tâche 3, qui les supprimera avec leurs routes.
- [ ] **Étape 4 : `npm run build -w @kitchen/shared`, tests verts, `tsc --noEmit`.**
- [ ] **Étape 5 : commit** — `feat(shared): états de compte et schéma de connexion Google (section 10)`

---

### Tâche 2 : Migration

**Fichiers :**
- Modifier : `prisma/schema.prisma`
- Créer : `prisma/migrations/0011_connexion_google/migration.sql`

Modèle `User` : ajouter `googleSub String? @unique`, `status AccountStatus @default(PENDING)` (nouvel enum PostgreSQL), rendre `passwordHash` **nullable** (D5), retirer `failedLogins` et `lockedUntil` (D9).

```sql
-- Connexion par compte Google (section 10, spec du 2026-10-18). `status` porte
-- trois états et non un booléen : « jamais validé » et « validé puis révoqué »
-- ne s'affichent pas pareil, et un booléen obligerait à deviner lequel on
-- regarde. Les comptes déjà en base passent ACTIVE : la mise à jour ne doit
-- enfermer personne dehors (D8). `passwordHash` devient nullable plutôt que de
-- recevoir une valeur aléatoire — une colonne qui ment sur son contenu est
-- pire qu'une colonne vide (D5). Le verrouillage après échecs disparaît avec
-- les mots de passe : un jeton Google ne se devine pas par essais (D9).

CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;
ALTER TABLE "User" ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'PENDING';
UPDATE "User" SET "status" = 'ACTIVE';
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" DROP COLUMN "failedLogins";
ALTER TABLE "User" DROP COLUMN "lockedUntil";

CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
```

- [ ] **Étape 1 : modifier le modèle.**
- [ ] **Étape 2 : écrire la migration à la main**, dans le style de `prisma/migrations/0009_suggestion_pool/migration.sql`.
- [ ] **Étape 3 : `npx prisma generate`, puis vérifier l'absence de dérive** (`prisma migrate diff` contre une base jetable ; PostgreSQL est disponible localement).
- [ ] **Étape 4 : commit** — `feat(auth): états de compte et identifiant Google sur User (section 10)`

---

### Tâche 3 : Vérification du jeton et connexion

**Fichiers :**
- Créer : `apps/api/src/auth/google-token.verifier.ts` (+ jeton d'injection)
- Modifier : `apps/api/src/auth/auth.service.ts`, `auth.controller.ts`, `auth.module.ts`, `auth.e2e-spec.ts`
- Supprimer : `apps/api/src/auth/password.ts` **seulement si** la tâche 7 ne s'en sert pas — la porte de secours en a besoin ; la garder et le dire en commentaire.
- Modifier : `apps/api/src/common/config.ts` (`GOOGLE_CLIENT_ID: z.string().default('')`)

**Dépendance :** `google-auth-library` dans `apps/api`. C'est la bibliothèque officielle de Google pour cette vérification exacte. Ne hache pas le jeton à la main : vérifier une signature RS256 contre un JWKS tournant, l'audience, l'émetteur et l'expiration est précisément le code qu'on n'écrit pas soi-même.

**Le verificateur est injecté derrière un jeton**, pour que les tests posent une doublure et ne touchent jamais le réseau :

```ts
export const GOOGLE_TOKEN_VERIFIER = Symbol('GOOGLE_TOKEN_VERIFIER');

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  sub: string;
  name: string | null;
}

export interface GoogleTokenVerifier {
  /** Lève `ApiError.unauthenticated` si le jeton n'est pas exploitable. */
  verify(credential: string): Promise<GoogleIdentity>;
}
```

**Comportement de `loginWithGoogle(credential, res)`** :

1. Vérifier le jeton. Audience = `GOOGLE_CLIENT_ID`. Échec → 401 « Connexion Google refusée ».
2. `emailVerified` faux → 401 « Adresse Google non vérifiée ».
3. Base vide → créer l'administrateur `ACTIVE`/`ADMIN` sous le verrou
   `LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE` déjà utilisé par `setup`,
   poser les emplacements par défaut (`createDefaultLocations`), ouvrir la session.
4. Compte trouvé par **adresse e-mail** : poser `googleSub` s'il est absent, puis
   selon `status` — `ACTIVE` → ouvrir la session ; `PENDING` → **403** « Votre
   demande attend la validation d'un administrateur. » ; `REVOKED` → **403**
   « Cet accès a été refusé. »
5. Adresse inconnue → créer un compte `PENDING`/`MEMBER`, `passwordHash` à `null`,
   **aucune session**, et rendre la même réponse 403 qu'un `PENDING` existant :
   une adresse déjà demandée et une adresse neuve ne doivent pas se distinguer.
6. Journaliser la création d'une demande et la création du premier administrateur.

**Routes :**
- `GET /auth/google/client-id` — **publique**, rend `{ clientId: string }` (`''` si non configuré, le front masque alors le bouton).
- `POST /auth/google` — **publique**, sous la même limitation de débit que l'ancienne connexion (`@nestjs/throttler` est déjà présent).
- Supprimer `POST /auth/login`, `POST /auth/setup`, `POST /me/password` et leurs schémas.
- `GET /auth/status` : `setupRequired` garde son sens (base vide), il indique maintenant qu'une première connexion Google créera l'administrateur.

- [ ] **Étape 1 : écrire les tests qui échouent** — un par point de vigilance 1 à 5, avec une doublure de vérificateur. Le point 4 (deux connexions simultanées sur base vide) se joue avec `Promise.all` sur deux appels.
- [ ] **Étape 2 : lancer, constater l'échec.**
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm test -w @kitchen/api` en entier, `tsc --noEmit`.**
- [ ] **Étape 5 : commit** — `feat(auth): connexion par jeton Google, validation requise (section 10)`

---

### Tâche 4 : Administration des comptes

**Fichiers :**
- Créer : `apps/api/src/accounts/` (module, contrôleur, service, spec) — un dossier par domaine, section 18
- Modifier : `apps/api/src/app.module.ts`

**Routes, toutes réservées aux administrateurs :**
- `GET /accounts` → `AccountDto[]`, tous états confondus, en attente d'abord puis par date décroissante.
- `POST /accounts/:id/approve` → passe `ACTIVE`.
- `POST /accounts/:id/revoke` → passe `REVOKED` **et révoque toutes les sessions du compte** (vigilance 3).

**Garde-fous, chacun avec son test :**
- Un membre non administrateur reçoit 403 sur les trois routes.
- Un administrateur ne peut pas se révoquer lui-même (403, message explicite) : sans cela, le dernier administrateur peut se couper l'accès et seule la porte de secours le rattrape.
- Révoquer le **dernier** administrateur actif est refusé, pour la même raison.

- [ ] **Étape 1 : tests d'abord** (les trois garde-fous, plus le tri de la liste).
- [ ] **Étape 2 : lancer, constater l'échec.**
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm test -w @kitchen/api`, `tsc --noEmit`.**
- [ ] **Étape 5 : commit** — `feat(accounts): validation et révocation des comptes par un administrateur (section 10)`

---

### Tâche 5 : Écran de connexion

**Fichiers :**
- Modifier : `apps/web/src/screens/login/` et `apps/web/src/screens/setup/`
- Créer : `apps/web/src/screens/login/google-sign-in-button.tsx` et son test
- Modifier : `apps/web/src/lib/queries.ts`, le client d'API

Reprendre le composant du guide, transposé en React 19 + Vite : charger
`https://accounts.google.com/gsi/client`, `initialize({ client_id, callback })`,
`renderButton`. Le Client ID vient de `GET /auth/google/client-id`, lu à
l'exécution — **jamais** d'une variable `import.meta.env`, figée au build (piège
n° 1 du guide, et l'image de Kitchen est construite une fois par la CI).

- Client ID vide → **aucun bouton**, et un message disant que la connexion Google n'est pas configurée. Pas de bouton mort.
- Un 403 « demande en attente » s'affiche comme une information, pas comme une erreur rouge : l'utilisateur n'a rien fait de mal.
- L'écran d'installation par mot de passe disparaît ; sur une base vide, l'écran explique que la première connexion Google crée l'administrateur.
- Retirer le formulaire de mot de passe et l'écran de changement de mot de passe.

- [ ] **Étape 1 : tests d'abord** — bouton absent sans Client ID ; message d'attente sur 403 ; appel à `POST /auth/google` avec le `credential` rendu par le callback (doublure de `window.google`).
- [ ] **Étape 2 : lancer, constater l'échec.**
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : tests de `apps/web`, `tsc --noEmit`.**
- [ ] **Étape 5 : commit** — `feat(web): connexion par bouton Google, mot de passe retiré (section 10)`

---

### Tâche 6 : Réglages › Comptes

**Fichiers :**
- Créer : `apps/web/src/screens/settings/accounts-section.tsx` et son test
- Modifier : l'écran Réglages

Section visible des seuls administrateurs. Les demandes en attente en tête, avec
adresse, nom et date, et deux boutons (« Valider », « Refuser »). En dessous, les
comptes actifs, avec « Révoquer ». Mobile d'abord : l'application est utilisée en
très grande majorité au téléphone, ces listes tiennent en pleine largeur, une
ligne par compte, les actions atteignables au pouce.

- [ ] **Étape 1 : tests d'abord** — la section n'apparaît pas pour un membre ; valider appelle la bonne route ; une liste vide affiche un état vide explicite.
- [ ] **Étape 2 : lancer, constater l'échec.**
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : tests de `apps/web`, `tsc --noEmit`.**
- [ ] **Étape 5 : commit** — `feat(web): gestion des comptes dans les réglages (section 10)`

---

### Tâche 7 : Porte de secours

**Fichiers :**
- Créer : `tools/acces-secours.ts` et son test
- Modifier : `apps/api/src/auth/auth.controller.ts` et `auth.service.ts`

Le script, lancé **dans le conteneur** depuis Dockge, prend une adresse en
argument : il crée ou réactive ce compte en `ACTIVE`/`ADMIN`, tire un mot de
passe aléatoire, en écrit le hachage Argon2id dans `passwordHash`, pose une
expiration **une heure** plus tard, et **affiche le mot de passe une seule fois
sur la sortie standard**.

`POST /auth/recovery` accepte adresse + mot de passe **uniquement** si le compte
porte un hachage non nul et une expiration de secours non dépassée. Le succès
efface le hachage et l'expiration dans la même transaction : un mot de passe de
secours ne sert qu'une fois. Même limitation de débit que `POST /auth/google`.

Cela demande deux colonnes de plus sur `User` (`recoveryExpiresAt`), donc une
migration `0012_acces_secours` écrite à la main.

**Ce qu'il ne faut pas faire :** exposer un formulaire de secours dans
l'interface. La route existe, elle n'est pas affichée ; elle n'ouvre rien tant
qu'aucun mot de passe de secours n'est en base.

- [ ] **Étape 1 : tests d'abord** — route refusée sans mot de passe de secours en base ; refusée après expiration ; mot de passe inutilisable une seconde fois ; compte promu `ACTIVE`/`ADMIN` par le script.
- [ ] **Étape 2 : lancer, constater l'échec.**
- [ ] **Étape 3 : implémenter.**
- [ ] **Étape 4 : `npm test -w @kitchen/api`, dérive de migration, `tsc --noEmit`.**
- [ ] **Étape 5 : commit** — `feat(auth): accès de secours en ligne de commande (section 10)`

---

### Tâche 8 : Parcours bout en bout et documentation

**Fichiers :**
- Modifier : `e2e/` — tous les parcours passent par la connexion
- Modifier : `README.md`, `docs/cahier-des-charges.md` (section 10 et section 26), `CLAUDE.md`

**Lis chaque fichier de `e2e/` avant de modifier quoi que ce soit** : tous les
parcours s'authentifient, et ce lot change la façon de le faire. Les deux lots
précédents ont laissé des parcours cassés faute de cette relecture.

La doublure de Google remplace le vérificateur de jeton, jamais le réseau.
Ajouter un parcours : une adresse inconnue se connecte, voit le message
d'attente, n'accède à rien ; un administrateur la valide ; elle entre.

README : la connexion Google, la validation par l'administrateur, la variable
`GOOGLE_CLIENT_ID`, **les étapes exactes de la console Google Cloud**, la porte
de secours et la façon de la lancer depuis Dockge, et une ligne de changelog.
Cahier des charges section 10 : les mots de passe ne sont plus le mécanisme
d'authentification ; amendement daté en section 26.

- [ ] **Étape 1 : relire les parcours existants.**
- [ ] **Étape 2 : adapter et ajouter le parcours de validation.**
- [ ] **Étape 3 : `tsc` sur les quatre projets** (les parcours Playwright sont **CI uniquement**).
- [ ] **Étape 4 : documentation.**
- [ ] **Étape 5 : commit** — `docs(auth): connexion Google, validation des comptes et accès de secours (section 10)`
