# Suggestions : parcours dirigé et filtres compacts — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** rendre l'écran Suggestions utilisable au téléphone : une question dirigée à l'entrée, quatre filtres sur une ligne, des titres lisibles.

**Spec:** `docs/specs/2026-10-11-suggestions-parcours-mobile.md`

## Global Constraints

- TypeScript strict, `any` interdit hors tests. Libellés en français, code en anglais.
- Cibles tactiles `min-h-touch`. La couleur ne porte jamais seule une information.
- **L'usage est très majoritairement mobile** : toute décision de mise en page se juge à 375 px de large, pas sur un écran de développeur.
- Règles métier dans `packages/shared`, jamais recopiées.
- `npm run build -w @kitchen/shared` après toute modification du paquet partagé.
- `README.md` et le changelog : par la DERNIÈRE tâche seulement.
- **`e2e/` est confié à la dernière tâche, qui doit relire TOUT le répertoire.** Les parcours figent des libellés et des structures ; ce lot en change beaucoup. Ils ne tournent qu'en CI après fusion : les oublier rend `main` rouge, c'est arrivé.

## Review Focus

1. La question bloquante ne doit pas réapparaître après chaque rafraîchissement de la fournée, ni au retour depuis une fiche de recette. → tâche 2.
2. Un sélecteur natif sur thème sombre : la liste déroulante est rendue par le système, pas par la page — vérifier qu'elle reste lisible et que l'option choisie se voit. → tâche 3.
3. Le filtre par type ne relance rien, mais la première réponse oriente l'appel : deux comportements pour un même contrôle, à ne pas confondre. → tâches 2 et 3.
4. Un titre de deux lignes change la hauteur des cartes : vérifier que rien ne déborde avec le plus long titre plausible. → tâche 4.
5. Retirer la mémorisation du volet ne doit pas casser la bascule elle-même. → tâche 1.

---

### Task 1 : Suggestions toujours en entrée (A1, D1)

**Files:**
- Delete: `apps/web/src/screens/recipes/recipe-tab-storage.ts` et son test
- Modify: `apps/web/src/components/shell/bottom-nav.tsx`, `recipe-tab-switch.tsx` si besoin
- Test: `bottom-nav.test.tsx`

- [ ] **Step 1 : adapter le test** — l'onglet « Recettes » pointe sur `/recettes`, inconditionnellement, quel que soit l'état du stockage. Le test du repli sans stockage disparaît avec le mécanisme qu'il couvrait : le dire dans le rapport.
- [ ] **Step 2 : lancer, vérifier l'échec**
- [ ] **Step 3 : supprimer le stockage et ses appels.** Supprimer, pas contourner : un mécanisme mort est pire qu'absent.
- [ ] **Step 4 : vérifier que la bascule Suggestions / Mes recettes fonctionne toujours**
- [ ] **Step 5 : types, lint, tests, commit** `feat(web): Suggestions redevient l'entrée du module (EF-25)`

---

### Task 2 : la question de type de plat (A2, A3, A5)

**Files:**
- Modify: `apps/web/src/screens/suggestions/suggestions-screen.tsx`
- Create: un composant de question et son test
- Test: `suggestions-screen.test.tsx`

**Interfaces:**
- Le type choisi alimente `SuggestionOrientation.dishType` pour la requête INITIALE (il existe déjà, tâche du 2026-10-08).

- [ ] **Step 1 : tests qui échouent** — sans type choisi, ni liste ni barre de filtres, et la question est posée avec les sept types ; une fois répondu, la requête part avec `dishType` ; la question ne revient pas après un rafraîchissement de la fournée ; un moyen de revenir à la question existe.
- [ ] **Step 2 : lancer, vérifier l'échec**
- [ ] **Step 3 : implémenter.** Le choix vit dans l'état de l'écran. Attention au piège : il ne doit pas se perdre au retour depuis une fiche de recette, ni déclencher un second appel.
- [ ] **Step 4 : relancer, vérifier le succès**
- [ ] **Step 5 : types, lint, tests, commit** `feat(suggestions): question de type de plat à l'entrée (EF-25)`

---

### Task 3 : quatre filtres sur une ligne (A4, A7, D5)

**Files:**
- Rewrite: `apps/web/src/screens/suggestions/orientation-bar.tsx` et son test

- [ ] **Step 1 : tests qui échouent** — les quatre sélecteurs existent et sont nommés ; changer le type de plat n'appelle pas le changement d'orientation serveur ; changer la cuisine, la durée ou la facilité l'appelle ; chaque sélecteur annonce sa valeur courante ; « Tout effacer » remet les quatre à zéro.
- [ ] **Step 2 : lancer, vérifier l'échec**
- [ ] **Step 3 : implémenter avec des `<select>` natifs.** Pas de menu maison : le natif ouvre une roue pleine largeur au téléphone, gère le clavier et le lecteur d'écran gratuitement, et c'est ce que D5 demande. Chaque sélecteur porte une option « Tous » / « Toutes » pour l'absence de contrainte.
- [ ] **Step 4 : vérifier à 375 px que la ligne tient sans débordement horizontal**
- [ ] **Step 5 : types, lint, tests, commit** `feat(suggestions): quatre filtres sur une ligne (EF-25)`

---

### Task 4 : titres sur deux lignes, parcours bout en bout, documentation (A6)

**Files:**
- Modify: `apps/web/src/screens/suggestions/suggestion-card.tsx`, `apps/web/src/screens/recipes/recipe-card.tsx`
- Modify: `e2e/` — tout ce que ce lot change
- Modify: `README.md`

- [ ] **Step 1 : test du titre** — un titre long s'affiche sur deux lignes au plus, sans troncature au milieu d'un mot.
- [ ] **Step 2 : implémenter sur les deux cartes**
- [ ] **Step 3 : relire TOUT `e2e/`** — la question bloquante change l'arrivée sur Suggestions : tout parcours qui y atterrit doit désormais répondre avant de voir une recette. C'est le point le plus risqué du lot. Les parcours ne s'exécutent pas ici : ils se relisent.
- [ ] **Step 4 : `README.md`** — le parcours dirigé, les filtres compacts, la disparition de la mémorisation du volet. Une seule ligne de changelog.
- [ ] **Step 5 : types, lint, suite complète, `npx tsc -p e2e/tsconfig.json --noEmit`, commit**
