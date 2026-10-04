# Tests bout en bout des parcours — plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans` pour exécuter ce plan tâche par tâche. Les étapes
> sont des cases à cocher.

**But :** jouer les parcours de l'application dans un vrai navigateur, contre l'image Docker
construite depuis le dépôt, pour que la CI dise quelque chose de ce qui est réellement livré.

**Architecture :** un montage `docker compose` dédié — l'image, une base PostgreSQL jetable, et une
doublure HTTP qui rejoue les fixtures existantes — démarré par la CI, semé depuis le runner, puis
parcouru par Playwright en Chromium avec caméra simulée.

**Pile :** Playwright, Docker Compose, PostgreSQL 16, Node 22. Aucune dépendance nouvelle dans
`apps/` ni dans `packages/` : tout vit dans `e2e/` et dans `docker/`.

**Spécification :** `docs/specs/2026-10-04-tests-bout-en-bout.md` (décisions **[C1]** à **[C15]**).
Cahier : sections 3 (parcours) et 19 (tests).

## Contraintes globales

- **Aucun appel réseau sortant [C8].** Gemini et Open Food Facts passent par la doublure, branchée
  par `VISION_BASE_URL` et `OFF_BASE_URL`, qui existent déjà dans la configuration.
- **Les fixtures sont celles de `apps/api/test/fixtures/` [C11]**, jamais des copies.
- **La cible est l'image construite depuis `docker/Dockerfile` [C2] [C7]**, jamais un serveur de
  développement, jamais l'image publiée sur GHCR.
- **Le seed s'exécute depuis le runner**, pas dans le conteneur : l'image est installée avec
  `--omit=dev` et n'a donc pas `tsx`.
- **Le service worker reste actif [C13].** Les tests attendent le repos du réseau, et n'empilent pas
  d'attentes fixes.
- **Exécution en CI uniquement, sur `main` [C3] [C4].** Rien ne doit supposer un Docker local.
- Français pour les libellés et les commentaires, anglais pour les identifiants.
- TypeScript strict, `any` interdit.
- Un parcours ne dépend jamais de l'ordre d'exécution : la base repart de la semence avant chaque
  fichier **[C10]**.

## Points de vigilance

Cinq choses qui mordront si personne ne les traite d'avance :

1. **La caméra simulée [C12].** `--use-file-for-fake-video-capture` attend un fichier `.y4m` ou
   `.mjpeg`, pas un PNG. La vidéo doit être fabriquée, et le décodeur doit réellement lire le
   code-barres dedans. C'est le risque principal du plan : il est isolé en tâche 2, avant que cinq
   parcours en dépendent.
2. **Le service worker sert une coque en cache.** Après une navigation, l'application peut afficher
   l'état précédent une fraction de seconde. Les assertions doivent porter sur un contenu, jamais
   sur l'absence immédiate d'un autre.
3. **La remise à zéro entre fichiers coûte cher si elle rejoue le seed.** Semer une fois, prendre un
   `pg_dump`, puis restaurer entre les fichiers.
4. **L'application exige HTTPS pour la caméra**, sauf sur `localhost` — que le navigateur traite
   comme un contexte sûr. Le montage doit donc être atteint par `http://localhost:<port>` et jamais
   par une IP.
5. **Le premier démarrage applique les migrations** et peut prendre une dizaine de secondes. Attendre
   le healthcheck du conteneur, pas une durée fixe.

## Structure des fichiers

```
docker-compose.e2e.yml            le montage : app, db, doublure
e2e/playwright.config.ts          projet Chromium, caméra simulée, artefacts
e2e/fixtures/stub-server.ts       doublure HTTP de Gemini et d'Open Food Facts
e2e/fixtures/barcode-video.ts     fabrication de la vidéo de code-barres
e2e/support/database.ts           semence et restauration entre fichiers
e2e/support/auth.ts               ouverture de session
e2e/p1-inventaire.spec.ts         … un fichier par parcours
.github/workflows/ci.yml          job « e2e », sur main seulement
```

---

### Task 1: Le montage et la doublure

**Files:**
- Create: `docker-compose.e2e.yml`, `e2e/fixtures/stub-server.ts`, `e2e/fixtures/stub-server.spec.ts`
- Modify: `package.json` (scripts `e2e:up`, `e2e:down`)

**Interfaces:**
- Produces : un montage joignable sur `http://localhost:3100`, une base sur `localhost:55432`, une
  doublure sur `http://localhost:3101`.

- [ ] **Step 1 : écrire le test de la doublure**

Un test Vitest qui démarre `stub-server.ts` sur un port éphémère et vérifie :

```ts
it('rend une fiche Open Food Facts connue', async () => { /* GET /api/v2/product/<ean> → 200, nom attendu */ });
it('rend 404 sur un code-barres inconnu', async () => { /* … */ });
it('rend une reconnaissance de vision depuis la fixture', async () => { /* POST .../generateContent */ });
it('rend une fournée de suggestions depuis la fixture', async () => { /* distingue les deux appels par le corps */ });
it('rend 500 quand on le lui demande, pour jouer la panne', async () => { /* en-tête ou chemin dédié */ });
```

La doublure **lit les fixtures existantes** de `apps/api/test/fixtures/` **[C11]** ; elle n'en
recopie aucune. Les deux usages de Gemini arrivent sur la même route `generateContent` : les
distinguer par la présence de l'outil de recherche ou par un marqueur du prompt, et le commenter.

- [ ] **Step 2 : vérifier l'échec**

Run : `npx vitest run e2e/fixtures --root .`
Attendu : FAIL, module introuvable.

- [ ] **Step 3 : implémenter la doublure, puis le montage**

`docker-compose.e2e.yml` démarre trois services : `app` (`build: { context: ., dockerfile:
docker/Dockerfile }`), `db` (PostgreSQL 16, port publié, aucun volume persistant) et `stub`. `app`
reçoit `VISION_PROVIDER=gemini`, `VISION_API_KEY=cle-de-test`, `VISION_BASE_URL=http://stub:3101`,
`OFF_BASE_URL=http://stub:3101`, et dépend du healthcheck de `db`.

Le port de l'application est publié sur **`127.0.0.1:3100`** : la caméra exige un contexte sûr, et
`localhost` en est un, contrairement à une IP **[vigilance 4]**.

- [ ] **Step 4 : vérifier**

```bash
docker compose -f docker-compose.e2e.yml up -d --wait
curl -fsS http://localhost:3100/api/v1/health
docker compose -f docker-compose.e2e.yml down -v
```
Attendu : `status: ok`, migrations appliquées.

- [ ] **Step 5 : commit**

```bash
git add docker-compose.e2e.yml e2e package.json
git commit -m "test(e2e): montage docker et doublure des services externes (section 19)"
```

---

### Task 2: Playwright, la caméra simulée et la première session

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/fixtures/barcode-video.ts`, `e2e/support/auth.ts`,
  `e2e/support/database.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json` (dépendance `@playwright/test`, script `e2e`)

**Interfaces:**
- Produces : `loginAsAdmin(page)`, `seedDatabase()`, `restoreDatabase()`, et un projet Chromium
  configuré avec la caméra simulée.

- [ ] **Step 1 : écrire les tests qui échouent**

```ts
test('l’application répond et affiche la connexion', async ({ page }) => { /* … */ });
test('une session s’ouvre et le stock s’affiche', async ({ page }) => { /* après loginAsAdmin */ });
test('la caméra simulée permet de lire un code-barres', async ({ page }) => {
  // Ouvre le scan, attend le tiroir de validation, et vérifie qu'il porte le
  // produit correspondant au code-barres de la vidéo.
});
```

Le troisième est **le test qui décide du plan** : s'il ne passe pas, c'est le repli de la section 7
de la spécification qu'il faut acter, pas cinq parcours à écrire par-dessus un socle instable.

- [ ] **Step 2 à 4 : échec, implémentation, succès**

`barcode-video.ts` fabrique un `.y4m` à partir d'un code-barres EAN-13 rendu en PNG, par `ffmpeg`
présent sur le runner GitHub. La vidéo boucle sur une image fixe : le décodeur n'a pas besoin de
mouvement, seulement d'une image nette.

Chromium est lancé avec `--use-fake-device-for-media-stream`,
`--use-file-for-fake-video-capture=<chemin>` et `--use-fake-ui-for-media-stream` pour que
l'autorisation ne soit pas demandée.

`database.ts` sème une fois par exécution (`npm run seed:dev -w @kitchen/api` depuis le runner,
contre le port publié), prend un `pg_dump`, et expose `restoreDatabase()` pour les fichiers suivants
**[vigilance 3]**.

`playwright.config.ts` : un seul worker, `baseURL` sur `http://localhost:3100`, trace, capture et
vidéo **à l'échec seulement** **[C14]**, et `webServer` laissé vide — le montage est démarré par la
CI, pas par Playwright.

- [ ] **Step 5 : commit**

```bash
git add e2e package.json package-lock.json
git commit -m "test(e2e): outillage Playwright, caméra simulée et session (section 19)"
```

---

### Task 3: P1 — inventaire initial

**Files:**
- Create: `e2e/p1-inventaire.spec.ts`

- [ ] **Step 1 : écrire les tests**

```ts
test('enchaîne deux scans sans refermer la caméra', async ({ page }) => { /* … */ });
test('garde l’emplacement choisi d’un article à l’autre', async ({ page }) => { /* … */ });
test('ajoute en quantité 1 par défaut', async ({ page }) => { /* … */ });
test('annule l’ajout depuis le bandeau dans les cinq secondes', async ({ page }) => {
  // Le lot ne doit plus exister ensuite dans la liste du stock.
});
test('ne crée rien tant que la validation n’a pas été faite', async ({ page }) => {
  // Régression du défaut corrigé en 0.6 : le scan ne doit pas ajouter tout seul.
});
```

- [ ] **Step 2 à 3 : implémenter, vérifier, commit**

Les sélecteurs passent par les rôles et les libellés français affichés, jamais par des classes.
Si un élément n'est pas atteignable par son rôle, c'est l'application qu'il faut corriger — le
signaler dans le rapport plutôt que de poser un sélecteur fragile.

```bash
git add e2e && git commit -m "test(e2e): parcours P1, inventaire initial (section 3)"
```

---

### Task 4: P2 — rangement des courses

**Files:**
- Create: `e2e/p2-rangement.spec.ts`

- [ ] **Step 1 : écrire les tests**

```ts
test('ouvre le tiroir de validation sur un produit reconnu', async ({ page }) => { /* … */ });
test('accepte une quantité saisie à la virgule française', async ({ page }) => { /* 1,5 */ });
test('retombe sur la saisie manuelle quand le code-barres est inconnu', async ({ page }) => { /* 404 de la doublure */ });
test('signale la panne du service de reconnaissance sans perdre la saisie', async ({ page }) => { /* 500 de la doublure */ });
```

La saisie de la DLC n'existe pas : elle est hors périmètre **[C1]**, et le fichier le dit en
commentaire d'en-tête pour que le manque soit lisible.

- [ ] **Step 2 à 3 : implémenter, vérifier, commit**

```bash
git add e2e && git commit -m "test(e2e): parcours P2, rangement des courses (section 3)"
```

---

### Task 5: P3 — consommation

**Files:**
- Create: `e2e/p3-consommation.spec.ts`

- [ ] **Step 1 : écrire les tests**

```ts
test('décrémente un article depuis la recherche', async ({ page }) => { /* quantité affichée après */ });
test('consomme tout par un appui long', async ({ page }) => { /* l’article quitte la liste active */ });
test('refuse de descendre sous zéro', async ({ page }) => { /* message français, quantité inchangée */ });
test('la quantité affichée suit la somme des mouvements', async ({ page }) => {
  // Deux consommations successives : la valeur affichée est la somme, pas la dernière écriture.
});
```

Le basculement en liste de courses au seuil est hors périmètre **[C1]**, dit en commentaire d'en-tête.

- [ ] **Step 2 à 3 : implémenter, vérifier, commit**

```bash
git add e2e && git commit -m "test(e2e): parcours P3, consommation (section 3)"
```

---

### Task 6: P4 — consultation

**Files:**
- Create: `e2e/p4-consultation.spec.ts`

- [ ] **Step 1 : écrire les tests**

```ts
test('trouve un produit par son nom, accents ignorés', async ({ page }) => { /* « crepes » trouve « Crêpes » */ });
test('filtre par emplacement, sous-emplacements compris', async ({ page }) => { /* … */ });
test('liste ce qui périme bientôt, du plus urgent au moins urgent', async ({ page }) => { /* … */ });
test('affiche la version de l’application', async ({ page }) => { /* demandé explicitement par Franck en 0.5 */ });
```

- [ ] **Step 2 à 3 : implémenter, vérifier, commit**

```bash
git add e2e && git commit -m "test(e2e): parcours P4, consultation (section 3)"
```

---

### Task 7: P5 — suggestions de recettes

**Files:**
- Create: `e2e/p5-suggestions.spec.ts`

- [ ] **Step 1 : écrire les tests**

```ts
test('ouvre Suggestions en entrée du module Recettes', async ({ page }) => { /* /recettes */ });
test('affiche une fournée construite sur le stock', async ({ page }) => { /* douze cartes, provenance visible */ });
test('n’affiche aucune étape avant conservation', async ({ page }) => { /* les deux provenances se ressemblent */ });
test('relance une recherche quand on choisit une région', async ({ page }) => { /* un appel de plus à la doublure */ });
test('conserve une recette composée par l’IA, qui apparaît dans Mes recettes', async ({ page }) => {
  // Puis la fiche de la recette porte enfin ses étapes.
});
test('dit en français que le fournisseur n’est pas configuré', async ({ page }) => {
  // Montage redémarré avec VISION_PROVIDER=none.
});
```

La conservation d'une recette **venant du web** n'est pas jouée **[C15]** : les garde-fous du
récupérateur interdisent une doublure locale. Le dire en commentaire d'en-tête.

- [ ] **Step 2 à 3 : implémenter, vérifier, commit**

```bash
git add e2e && git commit -m "test(e2e): parcours P5, suggestions de recettes (EF-26)"
```

---

### Task 8: Le job de CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1 : écrire le job**

Un job `e2e`, `if: github.ref == 'refs/heads/main'` **[C4]**, qui suit `check` :

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: check
    if: github.ref == 'refs/heads/main'
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - uses: docker/setup-buildx-action@v3
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: docker compose -f docker-compose.e2e.yml up -d --wait
      - run: npm run e2e
      - if: always()
        run: docker compose -f docker-compose.e2e.yml logs app > playwright-report/api.log || true
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: rapport-e2e
          path: playwright-report/
          retention-days: 14
      - if: always()
        run: docker compose -f docker-compose.e2e.yml down -v
```

Le cache `buildx` est branché sur le cache GitHub Actions pour que la construction de l'image ne
reparte pas de zéro à chaque exécution.

- [ ] **Step 2 : vérifier**

Le job ne peut être prouvé qu'une fois sur `main`. Avant la fusion : `act` n'est pas disponible, donc
vérifier la syntaxe par `gh workflow view`, et s'assurer que chaque commande du job a été lancée à la
main en local lors des tâches précédentes. Dire clairement dans le rapport ce qui n'a **pas** pu être
éprouvé avant la fusion.

- [ ] **Step 3 : commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: jouer les parcours bout en bout sur main (section 19)"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`
- Create: `docs/decisions/2026-10-04-tests-bout-en-bout.md`

- [ ] **Step 1 : README**

Une section Développement qui dit comment la suite tourne, et surtout **qu'elle ne tourne pas en
local** faute de Docker sur la machine de Franck **[C3]** : en cas d'échec, le rapport Playwright est
en artefact du job. Ajouter la ligne de version à « Derniers changements ». Ne pas écrire
`CHANGELOG.md`, généré par release-please.

- [ ] **Step 2 : décisions**

Renvoyer vers la spécification et ses quinze décisions plutôt que les recopier. Consigner les deux
limites assumées : le parcours web d'une recette conservée **[C15]**, et les parties de P2, P3 et P4
que l'application ne sait pas encore faire **[C1]**.

- [ ] **Step 3 : CLAUDE.md**

Déplacer les tests bout en bout de « reste à écrire » vers « ce qui est déjà fait », en précisant
leur périmètre réel. Ce qui reste : le jeu de non-régression de reconnaissance sur photos réelles,
la DLC dans le tiroir de scan, et le lot 2 (liste de courses, alertes, hors ligne, export enrichi).

- [ ] **Step 4 : vérification complète**

```bash
npm run build -w @kitchen/shared && npm run lint && npm run typecheck --workspaces --if-present \
  && npm test --workspaces --if-present && npm run build -w @kitchen/api && npm run build -w @kitchen/web
```

- [ ] **Step 5 : commit**

```bash
git add README.md CLAUDE.md docs
git commit -m "docs: tests bout en bout des parcours dans le README et décisions associées"
```
