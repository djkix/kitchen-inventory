# Ticket de caisse — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplir l'inventaire depuis la photo ou le PDF d'un ticket de caisse, par une liste à cocher où les produits connus arrivent cochés avec leur quantité à monter.

**Architecture:** Gemini lit le ticket et rend des lignes brutes ; le rapprochement au catalogue se fait côté serveur par des règles pures de `packages/shared`, jamais par le modèle. Les lignes lues sont gardées en base le temps de la validation, puis chaque ligne cochée passe par `StockService.create`, qui porte déjà la fusion de lots et l'idempotence. Les libellés non reconnus survivent dans une table d'alias que l'utilisateur alimente quand il veut.

**Tech Stack:** NestJS 12 + Prisma 6 + PostgreSQL 16, React 19 + Vite + TanStack Query 5, Zod 4 dans `packages/shared`, Gemini via l'API REST `generateContent`.

**Spec:** `docs/specs/2026-10-22-ticket-de-caisse.md`

## Global Constraints

- TypeScript strict, `noUncheckedIndexedAccess`, `any` interdit hors tests.
- Anglais pour le code et les identifiants, français pour les libellés d'interface et les messages d'erreur.
- Schémas Zod définis une seule fois dans `packages/shared`, réutilisés côté front.
- Règles métier en fonctions pures testées dans `packages/shared` ; jamais recopiées dans un contrôleur ou un composant.
- `StockItem.quantity` est matérialisée : toute écriture insère un `StockMovement` puis recalcule. Ne jamais écrire la quantité directement.
- Aucune modification de schéma sans migration Prisma versionnée et commitée.
- Aucun test ne dépend du réseau : réponses de Gemini rejouées depuis des fixtures.
- Chaque commit met à jour `README.md` en français ; la ligne de changelog est ajoutée au commit qui livre la fonctionnalité visible.
- Citer **EF-29** dans les commits et les tests.
- Le plafond mensuel (`VISION_MONTHLY_CAP_CENTS`) est partagé avec le scan et les recettes ; le quota journalier du ticket est distinct.

## Review Focus

Les cinq classes d'entrée que la spécification implique sans qu'aucune tâche ne les exerce naturellement. Chacune a son test, rattaché à la tâche qui porte le code.

1. **Ticket illisible** — photo floue, document qui n'est pas un ticket : l'écran doit le dire, pas afficher une liste vide. (Tâche 4)
2. **Validation rejouée** — double appui ou rafraîchissement : la quantité ne doit monter qu'une fois. (Tâche 5)
3. **Deux lignes identiques sur le même ticket** — « RIZ BASMATI 1KG » deux fois : les deux montent, le total est de deux. (Tâche 5)
4. **Produit suivi en grammes ou millilitres** — « 3 × » ne doit pas écrire trois grammes : la ligne passe en ambigu. (Tâche 2)
5. **Alias pointant vers un produit supprimé depuis** — la ligne redevient inconnue au lieu de planter. (Tâche 2)

---

### Task 1 : socle de données

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_receipt/migration.sql` (généré)

**Interfaces:**
- Produces: enum `AiPurpose` gagne la valeur `RECEIPT`. Modèles `ReceiptLabelAlias { id, label (unique, normalisé), productId, createdAt }`, `Receipt { id, locationId, status: DRAFT|VALIDATED, createdById, createdAt }`, `ReceiptLine { id, receiptId, position, rawLabel, quantity Decimal, productId (nullable), state: MATCHED|AMBIGUOUS|UNKNOWN, candidateIds String[] }`.

- [ ] **Step 1 : ajouter les trois modèles et la valeur d'enum à `prisma/schema.prisma`**

`ReceiptLabelAlias.label` porte un index unique : c'est la clé de l'apprentissage. `ReceiptLine.position` conserve l'ordre du ticket (D5). `candidateIds` liste les produits possibles d'une ligne ambiguë. Aucun champ de prix nulle part (non-objectif).

- [ ] **Step 2 : générer la migration**

Run: `npx prisma migrate dev --name receipt`
Expected: migration créée, `npx prisma generate` passe.

- [ ] **Step 3 : vérifier l'absence de dérive**

Run: `npm test -w @kitchen/api`
Expected: PASS (aucun test ne change encore).

- [ ] **Step 4 : commit**

```bash
git add prisma/ && git commit -m "feat(ticket): modèles du ticket de caisse et de l'apprentissage des libellés (EF-29)"
```

---

### Task 2 : règles pures de rapprochement

**Files:**
- Create: `packages/shared/src/rules/receipt-match.ts`
- Create: `packages/shared/src/rules/receipt-match.test.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Modify: `packages/shared/src/rules/suggestion-ingredients.ts` (exporter `foldForComparison`, aujourd'hui privée)

**Interfaces:**
- Consumes: `foldForComparison(value: string): string` de `suggestion-ingredients.ts`.
- Produces :
  - `normalizeReceiptLabel(raw: string): string` — repli de casse et d'accents, suppression des contenances (`1KG`, `75CL`, `500G`) et des multiplicateurs de tête.
  - `type ReceiptLineState = 'MATCHED' | 'AMBIGUOUS' | 'UNKNOWN'`
  - `type ReceiptCandidate = { id: string; name: string; defaultUnit: Unit }`
  - `matchReceiptLine(label: string, aliasProductId: string | null, candidates: readonly ReceiptCandidate[]): { state: ReceiptLineState; productId: string | null; candidateIds: string[] }`

- [ ] **Step 1 : écrire les tests qui échouent dans `receipt-match.test.ts`**

```ts
it('un alias connu l’emporte sur toute recherche', () => {
  expect(matchReceiptLine('PT DEJ CHOCO 500G', 'p1', []))
    .toEqual({ state: 'MATCHED', productId: 'p1', candidateIds: [] });
});

it('un seul candidat donne un rapprochement certain', () => {
  const r = matchReceiptLine('RIZ BASMATI 1KG', null, [{ id: 'p2', name: 'Riz basmati', defaultUnit: 'PIECE' }]);
  expect(r).toEqual({ state: 'MATCHED', productId: 'p2', candidateIds: ['p2'] });
});

it('deux candidats ne sont jamais tranchés en silence', () => {
  const r = matchReceiptLine('H OLIVE VIERGE 75CL', null, [
    { id: 'p3', name: 'Huile d’olive cuisson', defaultUnit: 'PIECE' },
    { id: 'p4', name: 'Huile d’olive assaisonnement', defaultUnit: 'PIECE' },
  ]);
  expect(r.state).toBe('AMBIGUOUS');
  expect(r.productId).toBeNull();
  expect(r.candidateIds).toEqual(['p3', 'p4']);
});

it('aucun candidat laisse la ligne inconnue', () => {
  expect(matchReceiptLine('SCE TOM BASILIC', null, []).state).toBe('UNKNOWN');
});

// Review Focus 4 : « 3 × » sur un produit suivi en grammes écrirait trois grammes.
it('un produit qui ne se compte pas à la pièce n’est jamais coché d’office', () => {
  const r = matchReceiptLine('FARINE T55', null, [{ id: 'p5', name: 'Farine T55', defaultUnit: 'GRAM' }]);
  expect(r.state).toBe('AMBIGUOUS');
});

// Review Focus 5 : alias orphelin.
it('un alias dont le produit a disparu rend la ligne inconnue', () => {
  expect(matchReceiptLine('PT DEJ CHOCO 500G', null, []).state).toBe('UNKNOWN');
});

it('normalise contenance, casse et accents', () => {
  expect(normalizeReceiptLabel('H OLIVE VIERGE 75CL')).toBe(normalizeReceiptLabel('huile olive vierge'));
});
```

- [ ] **Step 2 : lancer les tests pour les voir échouer**

Run: `npx vitest run --root packages/shared src/rules/receipt-match.test.ts`
Expected: FAIL, fonctions non définies.

- [ ] **Step 3 : implémenter `normalizeReceiptLabel` et `matchReceiptLine`**

L'alias est consulté en premier : s'il est fourni, aucun rapprochement n'est tenté. Sinon, un candidat est retenu quand son nom normalisé contient tous les mots significatifs du libellé normalisé, ou l'inverse. Un seul candidat dont `defaultUnit` vaut `PIECE` donne `MATCHED` ; toute autre unité, ou plus d'un candidat, donne `AMBIGUOUS` avec la liste.

- [ ] **Step 4 : vérifier que les tests passent**

Run: `npx vitest run --root packages/shared src/rules/receipt-match.test.ts`
Expected: PASS

- [ ] **Step 5 : commit**

```bash
git add packages/shared && git commit -m "feat(ticket): rapprochement d'une ligne de ticket au catalogue (EF-29)"
```

---

### Task 3 : lecture du ticket par Gemini

**Files:**
- Create: `apps/api/src/receipts/gemini-receipt.reader.ts`
- Create: `apps/api/src/receipts/gemini-receipt.reader.spec.ts`
- Modify: `apps/api/src/media/media.service.ts:25-27` (accepter `application/pdf`)
- Modify: `apps/api/src/common/config.ts` (ajouter `RECEIPT_DAILY_QUOTA`, défaut 10)

**Interfaces:**
- Consumes: `estimateCostCents`, `throwQuotaRefusal`, `withQuotaFallback` de `apps/api/src/recognition/providers/gemini.provider.ts`.
- Produces: `class GeminiReceiptReader { read(file: Buffer, mimeType: string, model?: string): Promise<{ lines: RawReceiptLine[]; raw: GeminiResponse; costCents: number | null }> }` avec `type RawReceiptLine = { label: string; quantity: number }`.

- [ ] **Step 1 : écrire le test qui échoue, sur une fixture de réponse Gemini**

Le test rejoue une réponse contenant quatre lignes dont un sac plastique et un total, et vérifie que le lecteur ne rend que les deux produits, dans l'ordre, et que « 3 × RIZ » donne `quantity: 3`. Un second test rejoue une réponse vide et attend une `ProviderError` au message français (Review Focus 1, dont le rendu à l'écran est vérifié en tâche 4).

- [ ] **Step 2 : lancer le test pour le voir échouer**

Run: `npx vitest run --root apps/api src/receipts/gemini-receipt.reader.spec.ts`
Expected: FAIL

- [ ] **Step 3 : implémenter le lecteur**

Appel `generateContent` avec `responseSchema` contraignant un tableau `{ label, quantity }`, l'image ou le PDF en `inlineData`. Le prompt, en français, demande les seuls produits alimentaires, dans l'ordre du ticket, en recopiant le libellé tel qu'il est imprimé, et d'ignorer sacs, remises, total, fidélité et rendu monnaie. Élargir `EXTENSIONS` de `MediaService` à `application/pdf`.

- [ ] **Step 4 : vérifier que les tests passent**

Run: `npx vitest run --root apps/api src/receipts/gemini-receipt.reader.spec.ts`
Expected: PASS

- [ ] **Step 5 : commit**

```bash
git add apps/api packages/shared && git commit -m "feat(ticket): lecture d'un ticket photo ou PDF par Gemini (EF-29)"
```

---

### Task 4 : API de lecture

**Files:**
- Create: `apps/api/src/receipts/receipts.controller.ts`, `receipts.service.ts`, `receipts.module.ts`
- Create: `apps/api/src/receipts/receipts.e2e-spec.ts`
- Create: `packages/shared/src/schemas/receipt.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `GeminiReceiptReader` (tâche 3), `matchReceiptLine` et `normalizeReceiptLabel` (tâche 2), modèles Prisma (tâche 1).
- Produces :
  - `POST /receipts` (multipart, champ `file`, champ `locationId`) → `ReceiptDto`
  - `GET /receipts/:id` → `ReceiptDto`
  - `ReceiptDto = { id, locationId, lines: ReceiptLineDto[] }`
  - `ReceiptLineDto = { id, position, rawLabel, quantity, state, product: ProductDto | null, candidates: ProductDto[], currentQuantity: number }`
  - `currentQuantity` est le total du produit dans l'emplacement choisi, tous lots confondus : c'est le « 2 » du « 2 → 3 » (choix de la spécification).

- [ ] **Step 1 : écrire les tests bout en bout qui échouent**

Un ticket déposé rend ses lignes dans l'ordre, avec leurs trois états, et le brouillon est relisible par `GET`. Un ticket que le modèle ne sait pas lire rend 502 avec un message français (Review Focus 1). Le quota journalier `RECEIPT_DAILY_QUOTA` épuisé rend 429, et le plafond mensuel partagé aussi.

- [ ] **Step 2 : lancer pour voir échouer**

Run: `npx vitest run --root apps/api src/receipts/receipts.e2e-spec.ts`
Expected: FAIL

- [ ] **Step 3 : implémenter le service et le contrôleur**

À la lecture : charger le catalogue de produits et les alias, appeler `matchReceiptLine` par ligne, écrire `Receipt` + `ReceiptLine` en `DRAFT`. Le fichier n'est **jamais** passé à `MediaService.save` : il est lu puis abandonné. Journaliser l'appel dans `RecognitionLog` avec `purpose: 'RECEIPT'` et son coût.

- [ ] **Step 4 : vérifier**

Run: `npm test -w @kitchen/api`
Expected: PASS

- [ ] **Step 5 : commit**

```bash
git add apps/api packages/shared && git commit -m "feat(ticket): lecture d'un ticket et brouillon de lignes (EF-29)"
```

---

### Task 5 : API de validation

**Files:**
- Modify: `apps/api/src/receipts/receipts.service.ts`, `receipts.controller.ts`, `receipts.e2e-spec.ts`
- Modify: `packages/shared/src/schemas/receipt.ts`

**Interfaces:**
- Consumes: `StockService.create(input: CreateStockItemInput, user: RequestUser)` de `apps/api/src/stock/stock.service.ts`.
- Produces: `POST /receipts/:id/validate` prenant `{ lines: Array<{ id: string; productId: string; quantity: number; clientOpId: string }> }` → `{ added: number }`.

- [ ] **Step 1 : écrire les tests qui échouent**

```
- valide deux lignes cochées et laisse les autres de côté : deux mouvements, les quantités montent
- Review Focus 2 : rejouer la même validation avec les mêmes clientOpId n'ajoute rien de plus
- Review Focus 3 : deux lignes du même produit montent la quantité de deux au total
- une ligne absente du corps n'est pas ajoutée
- un ticket déjà VALIDATED est refusé
```

- [ ] **Step 2 : lancer pour voir échouer**

Run: `npx vitest run --root apps/api src/receipts/receipts.e2e-spec.ts`
Expected: FAIL

- [ ] **Step 3 : implémenter la validation**

Chaque ligne appelle `StockService.create` avec le `locationId` du ticket, sans `expiryDate` ni `estimateExpiry` (D2), en portant le `clientOpId` fourni — c'est lui qui rend l'opération rejouable sans doubler. Le ticket passe en `VALIDATED`. Les lignes `UNKNOWN` non validées nourrissent la liste d'attente de la tâche 6 ; elles ne créent aucun produit.

- [ ] **Step 4 : vérifier**

Run: `npm test -w @kitchen/api`
Expected: PASS

- [ ] **Step 5 : commit**

```bash
git add apps/api packages/shared && git commit -m "feat(ticket): validation d'un ticket vers le stock (EF-29)"
```

---

### Task 6 : API des libellés en attente

**Files:**
- Modify: `apps/api/src/receipts/receipts.service.ts`, `receipts.controller.ts`, `receipts.e2e-spec.ts`

**Interfaces:**
- Produces :
  - `GET /receipts/pending-labels` → `Array<{ label: string; seenAt: string; count: number }>`
  - `POST /receipts/pending-labels/attach` prenant `{ label: string; productId: string }` → `204`
  - `GET /receipts/pending-labels/count` → `{ count: number }` (pour la pastille de l'onglet)

- [ ] **Step 1 : écrire les tests qui échouent**

Un libellé inconnu apparu sur deux tickets ne figure qu'une fois, avec `count: 2`. L'attacher crée l'alias ; le même libellé sur un ticket suivant arrive alors `MATCHED`. Attacher un libellé déjà attaché met l'alias à jour plutôt que d'échouer.

- [ ] **Step 2 : lancer pour voir échouer**

Run: `npx vitest run --root apps/api src/receipts/receipts.e2e-spec.ts`
Expected: FAIL

- [ ] **Step 3 : implémenter**

La liste est dérivée des `ReceiptLine` d'état `UNKNOWN` sans alias correspondant, groupées par `normalizeReceiptLabel`. L'attache écrit un `ReceiptLabelAlias` (upsert sur `label`).

- [ ] **Step 4 : vérifier**

Run: `npm test -w @kitchen/api`
Expected: PASS

- [ ] **Step 5 : commit**

```bash
git add apps/api && git commit -m "feat(ticket): libellés en attente et apprentissage manuel (EF-29)"
```

---

### Task 7 : écran Courses

**Files:**
- Create: `apps/web/src/screens/shopping/receipt-screen.tsx`, `receipt-screen.test.tsx`, `pending-labels-section.tsx`, `pending-labels-section.test.tsx`
- Modify: `apps/web/src/app.tsx:65` (remplacer `ComingSoonScreen`)
- Modify: `apps/web/src/components/shell/bottom-nav.tsx` (pastille de compte)
- Modify: `apps/web/src/lib/queries.ts`
- Delete: `apps/web/src/screens/placeholder/coming-soon-screen.tsx` si plus aucun appelant

**Interfaces:**
- Consumes: les routes des tâches 4 à 6.

- [ ] **Step 1 : écrire les tests qui échouent**

```
- sans emplacement choisi, la prise de photo est indisponible
- les lignes s'affichent dans l'ordre du ticket, reconnues et inconnues mêlées (D5)
- une ligne MATCHED est cochée, une AMBIGUOUS et une UNKNOWN ne le sont pas (D6)
- une ligne MATCHED affiche « 2 → 3 »
- la quantité est modifiable et le « → » suit
- choisir un candidat sur une ligne ambiguë la coche
- le bouton annonce le nombre de produits à ajouter
- Review Focus 1 : un ticket illisible affiche le message du serveur, pas une liste vide
- la pastille de l'onglet porte le nombre de libellés en attente
```

- [ ] **Step 2 : lancer pour voir échouer**

Run: `npx vitest run --root apps/web src/screens/shopping`
Expected: FAIL

- [ ] **Step 3 : implémenter l'écran**

Un sélecteur d'emplacement, puis un `<input type="file" accept="image/*,application/pdf" capture="environment">` — l'appareil natif, comme le scan photo. La liste suit `position`. Chaque ligne porte sa case, le nom du produit, le libellé brut en dessous, la quantité modifiable et le mouvement. Les libellés en attente sont une section repliée sous la liste.

- [ ] **Step 4 : vérifier**

Run: `npm test -w @kitchen/web`
Expected: PASS

- [ ] **Step 5 : mettre à jour `README.md` et la ligne de changelog, puis commit**

```bash
git add apps/web README.md && git commit -m "feat(ticket): écran Courses, ticket photographié et validé (EF-29)"
```

---

### Task 8 : parcours bout en bout et amendement du cahier

**Files:**
- Create: `e2e/p7-ticket.spec.ts`
- Modify: `e2e/fixtures/stub-server.ts` (réponse de ticket)
- Modify: `docs/cahier-des-charges.md` (sections 3, 14, 26 ; EF-12 et EF-24 abandonnées, EF-29 ajoutée)
- Modify: `README.md`

- [ ] **Step 1 : écrire le parcours P7**

Choisir un emplacement, déposer une image, voir les lignes dans l'ordre, décocher une ligne, valider, et retrouver les quantités montées dans le Stock. La doublure de Gemini rend un ticket fixe.

- [ ] **Step 2 : lancer la suite web et API**

Run: `npm test`
Expected: PASS

- [ ] **Step 3 : amender le cahier des charges**

Section 3 : le parcours de rangement des courses gagne la voie du ticket. Section 14 : l'écran Courses change de nature. Section 26 : une ligne datée du 2026-10-22 disant qu'EF-12 et EF-24 sont abandonnées au profit d'EF-29, avec le motif — l'inventaire sert le fond du placard, pas le suivi des achats à faire.

- [ ] **Step 4 : commit**

```bash
git add e2e docs README.md && git commit -m "test(ticket): parcours bout en bout P7 et amendement du cahier (EF-29)"
```
