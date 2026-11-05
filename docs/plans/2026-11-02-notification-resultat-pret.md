# Notification « réponse prête » — plan d'exécution

> **Pour un exécutant agentique :** SOUS-COMPÉTENCE REQUISE — `superpowers:executing-plans`
> (choisi : exécution native dans la session). Les étapes sont cochables.

**But :** être prévenu par une notification du téléphone quand une demande au
modèle aboutit alors qu'on a quitté l'écran, et ne plus perdre une demande
refusée pour une pause Gemini.

**Architecture :** une ligne `AiRequest` par appel au modèle, ouverte par le
point d'entrée avant de partir chez Google et close à l'arrivée du résultat.
La réponse HTTP reste synchrone ; la ligne ne sert que si l'écran est parti.
Une demande refusée pour pause garde son entrée et est rejouée à la reprise.
Web Push pour l'annonce, service worker écrit à la main.

**Pile :** NestJS + Prisma + PostgreSQL, React + Vite + Tailwind,
`packages/shared` pour les règles pures et les schémas Zod, `web-push` côté
serveur, `vite-plugin-pwa` en `injectManifest`.

**Conception :** [docs/specs/2026-11-02-notification-resultat-pret.md](../specs/2026-11-02-notification-resultat-pret.md)
— le plan argumente depuis elle, les deux se lisent ensemble.

## Contraintes générales

- TypeScript strict, `any` interdit hors tests.
- Anglais pour le code et les identifiants, français pour les libellés et les
  messages d'erreur — **y compris le texte des notifications**.
- Toute règle métier est une fonction pure de `packages/shared`, testée, jamais
  recopiée dans un contrôleur ou un composant (D9).
- Validation des entrées par Zod, schémas définis une seule fois dans
  `packages/shared`.
- Aucune modification de schéma sans migration Prisma versionnée et commitée.
- Aucun test ne dépend du réseau : le service de push est doublé comme le sont
  Gemini et Open Food Facts.
- Plafond du différé : **une heure** (`DEFERRAL_CEILING_MS`), puis abandon
  annoncé (D6).
- Sans `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, tout continue de fonctionner
  et rien n'est annoncé (D11). C'est une exigence testée, pas un repli tacite.
- `README.md` et la ligne de « Derniers changements » sont mis à jour dans la
  tâche 8, qui rend la fonctionnalité visible.

## Points de vigilance

Cinq classes d'entrée que la conception implique sans qu'aucune tâche ne les
exerce naturellement. Chacune reçoit son test dans la tâche qui en porte le
code.

1. **Deux demandes différées du même usage pour le même utilisateur** — la
   seconde doit remplacer la première, sans notification pour celle qu'on
   abandonne, et l'entrée de l'abandonnée doit être effacée du disque
   (D15, tâche 6).
2. **Un abonnement périmé** — le service de push répond 404 ou 410 ; la ligne
   est supprimée et l'envoi aux autres appareils continue (D7, tâche 3).
3. **Un `id` de demande déjà pris** — le client rejoue le même identifiant
   (reprise réseau) ; la ligne existante est renvoyée plutôt que dupliquée
   (D4, tâche 4).
4. **Un redémarrage avec des lignes `RUNNING`** — elles sont closes en échec
   au démarrage, et annoncées seulement si l'écran avait été quitté
   (D12, tâche 6).
5. **Un quota épuisé au moment du rejeu** — abandon annoncé avec sa raison,
   jamais un nouveau différé (D13, tâche 6).

---

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `packages/shared/src/rules/ai-requests.ts` | règles pures : faut-il annoncer, le différé tient-il dans le plafond, texte de la notification |
| `packages/shared/src/schemas/notifications.ts` | schémas Zod et DTO : abonnement, état d'une demande |
| `prisma/schema.prisma`, `prisma/migrations/0018_notifications/` | `AiRequest`, `PushSubscription`, deux énumérations |
| `apps/api/src/notifications/push.service.ts` | envoi Web Push, suppression des abonnements périmés |
| `apps/api/src/notifications/notifications.controller.ts` | clé publique, abonnement, désabonnement |
| `apps/api/src/ai-requests/ai-request.service.ts` | ouverture, clôture, départ de page, récupération, purge |
| `apps/api/src/ai-requests/ai-request.controller.ts` | `GET /ai-requests/:id`, `POST /ai-requests/:id/background` |
| `apps/api/src/ai-requests/deferral.service.ts` | conservation de l'entrée, rejeu à la reprise, abandon |
| `apps/web/src/sw.ts` | service worker : `push`, `notificationclick`, et le bandeau de mise à jour reconduit |
| `apps/web/src/lib/ai-request.ts` | identifiant engendré, signal de départ de page, récupération au retour |
| `apps/web/src/screens/settings/notifications-row.tsx` | l'interrupteur, et ce qu'il dit quand il ne peut pas |

---

## Tâche 1 : les règles pures et les schémas

**Fichiers :**
- Créer : `packages/shared/src/rules/ai-requests.ts`
- Créer : `packages/shared/src/schemas/notifications.ts`
- Modifier : `packages/shared/src/index.ts`
- Test : `packages/shared/src/rules/ai-requests.test.ts`

**Interfaces — produit :**

```ts
export const AI_REQUEST_KINDS = ['SCAN_IMAGE', 'SUGGESTIONS', 'VOICE', 'RECEIPT'] as const;
export type AiRequestKind = (typeof AI_REQUEST_KINDS)[number];
export type AiRequestState = 'RUNNING' | 'DEFERRED' | 'DONE' | 'FAILED' | 'ABANDONED';

/** Plafond du différé : au-delà, on abandonne plutôt que de réveiller (D6). */
export const DEFERRAL_CEILING_MS = 60 * 60_000;

/** D1 et D1b : l'écran quitté, ou le simple fait d'avoir été différée. */
export function shouldNotify(input: { leftScreen: boolean; wasDeferred: boolean }): boolean;

/** `null` quand la reprise tombe au-delà du plafond : la demande est abandonnée. */
export function deferralRetryAt(input: { now: Date; resumeAt: Date }): Date | null;

/** Texte de la notification, en français. `tag` vaut l'identifiant de la demande. */
export function notificationPayload(input: {
  id: string;
  kind: AiRequestKind;
  outcome: 'DONE' | 'ABANDONED';
  count?: number;
  reason?: string;
}): { title: string; body: string; url: string; tag: string };
```

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
describe('shouldNotify (D1, D1b)', () => {
  it('ne dit rien quand on est resté devant l’écran', () => {
    expect(shouldNotify({ leftScreen: false, wasDeferred: false })).toBe(false);
  });
  it('annonce quand l’écran a été quitté', () => {
    expect(shouldNotify({ leftScreen: true, wasDeferred: false })).toBe(true);
  });
  it('annonce une demande différée même sans avoir quitté l’écran', () => {
    expect(shouldNotify({ leftScreen: false, wasDeferred: true })).toBe(true);
  });
});

describe('deferralRetryAt (D6)', () => {
  const now = new Date('2026-11-02T22:00:00Z');
  it('retient une reprise dans le plafond', () => {
    expect(deferralRetryAt({ now, resumeAt: new Date('2026-11-02T22:20:00Z') })).toEqual(new Date('2026-11-02T22:20:00Z'));
  });
  it('abandonne au-delà d’une heure', () => {
    expect(deferralRetryAt({ now, resumeAt: new Date('2026-11-03T07:00:00Z') })).toBeNull();
  });
  it('accepte une reprise déjà passée : le rejeu est immédiat', () => {
    expect(deferralRetryAt({ now, resumeAt: new Date('2026-11-02T21:59:00Z') })).toEqual(now);
  });
});

describe('notificationPayload', () => {
  it('nomme ce qui est prêt plutôt que « traitement terminé »', () => {
    const p = notificationPayload({ id: 'a', kind: 'SUGGESTIONS', outcome: 'DONE', count: 6 });
    expect(p.title).toBe('6 idées de recettes');
    expect(p.url).toBe('/recettes/suggestions');
    expect(p.tag).toBe('a');
  });
  it('dit la raison d’un abandon', () => {
    const p = notificationPayload({ id: 'b', kind: 'VOICE', outcome: 'ABANDONED', reason: 'Le quota du jour est atteint.' });
    expect(p.body).toContain('Le quota du jour est atteint.');
  });
});
```

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

Lancer : `npx vitest run src/rules/ai-requests --root packages/shared`
Attendu : ÉCHEC, modules introuvables.

- [ ] **Étape 3 : écrire les trois fonctions et les schémas**

Dans `schemas/notifications.ts` : `pushSubscriptionSchema` (`endpoint` URL,
`keys.p256dh`, `keys.auth`, tous non vides), `PushSubscriptionInput`,
et l'interface `AiRequestStatusDto { id; kind; state; result; error; retryAt }`.
Exporter le tout depuis `index.ts`.

- [ ] **Étape 4 : lancer les tests, vérifier le succès**

- [ ] **Étape 5 : commit** — `feat(shared): règles de la notification « réponse prête »`

---

## Tâche 2 : le schéma et la migration

**Fichiers :**
- Modifier : `prisma/schema.prisma`
- Créer : `prisma/migrations/0018_notifications/migration.sql`
- Modifier : `apps/api/src/common/config.ts`

- [ ] **Étape 1 : ajouter les deux modèles et les deux énumérations**

`AiRequest` : `id` (String, `@id` — **engendré par le client**, pas de
`@default`), `userId`, `kind`, `state` (défaut `RUNNING`), `leftScreen`
(Boolean, défaut `false`), `inputPath` / `inputMime` / `inputJson` (nullables,
l'entrée conservée d'une demande différée), `result` (Json?), `error`
(String?), `retryAt`, `notifiedAt`, `createdAt`, `updatedAt`.
Index : `[state, retryAt]` et `[userId, kind, state]`.

`PushSubscription` : `id` cuid, `userId`, `endpoint` `@unique`, `p256dh`,
`auth`, `userAgent?`, `createdAt`, `lastUsedAt`. Index `[userId]`.
Les deux en `onDelete: Cascade` sur `User`, et les relations inverses ajoutées
au modèle `User`.

- [ ] **Étape 2 : engendrer la migration**

Lancer : `npm run prisma -- migrate dev --name notifications --create-only`
puis renommer le dossier en `0018_notifications` pour suivre la convention.

- [ ] **Étape 3 : ajouter les trois clés de configuration**

Dans `configSchema` : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (tous deux
`z.string().optional()`), `VAPID_SUBJECT` (`z.string().default('mailto:admin@localhost')`).
Optionnelles : leur absence éteint l'annonce sans rien casser (D11).

- [ ] **Étape 4 : vérifier l'absence de dérive**

Lancer : `npm test -w @kitchen/api` (la base embarquée applique les migrations).
Attendu : SUCCÈS.

- [ ] **Étape 5 : commit** — `feat(db): demandes au modèle et abonnements push (migration 0018)`

---

## Tâche 3 : l'envoi Web Push

**Fichiers :**
- Créer : `apps/api/src/notifications/push.service.ts`, `notifications.controller.ts`, `notifications.module.ts`
- Test : `apps/api/src/notifications/notifications.e2e-spec.ts`
- Modifier : `package.json` (dépendance `web-push`)

**Interfaces — produit :**

```ts
class PushService {
  /** Vrai si les clés VAPID sont configurées. Faux : tout est inerte (D11). */
  get enabled(): boolean;
  /** Envoie à tous les appareils abonnés de cet utilisateur. Les abonnements refusés (404, 410) sont supprimés. */
  async sendToUser(userId: string, payload: { title: string; body: string; url: string; tag: string }): Promise<void>;
}
```

Points d'entrée : `GET /notifications/public-key` (rend `{ publicKey: string | null }`),
`POST /notifications/subscription` (corps validé par `pushSubscriptionSchema`,
idempotent sur `endpoint`), `DELETE /notifications/subscription` (corps :
`{ endpoint }`).

- [ ] **Étape 1 : écrire les tests qui échouent**

Quatre cas : l'abonnement est enregistré et rattaché à l'utilisateur courant ;
un second appel avec le même `endpoint` ne crée pas de doublon ; un envoi
atteint les deux appareils de l'utilisateur et aucun de l'autre membre
(**point de vigilance 2** : un `endpoint` répondant 410 est supprimé et
l'envoi à l'autre aboutit quand même) ; sans clés VAPID, `enabled` est faux,
`GET /notifications/public-key` rend `null` et `sendToUser` ne lève pas.

Le service de push est doublé à la manière de `FakeHttp` : `web-push` reçoit
son client HTTP par injection, comme les fournisseurs reçoivent `GeminiService.http`.

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

Lancer : `npx vitest run src/notifications --root apps/api`

- [ ] **Étape 3 : installer `web-push` et écrire le service et le contrôleur**

- [ ] **Étape 4 : lancer les tests, vérifier le succès**

- [ ] **Étape 5 : commit** — `feat(api): abonnements et envoi Web Push`

---

## Tâche 4 : la ligne de demande

**Fichiers :**
- Créer : `apps/api/src/ai-requests/ai-request.service.ts`, `ai-request.controller.ts`, `ai-requests.module.ts`
- Test : `apps/api/src/ai-requests/ai-requests.e2e-spec.ts`

**Interfaces — consomme :** `shouldNotify`, `notificationPayload`,
`AiRequestKind` (tâche 1) ; `PushService.sendToUser` (tâche 3).

**Interfaces — produit :**

```ts
class AiRequestService {
  /** Ouvre la ligne, ou rend celle qui existe déjà pour cet `id` (point de vigilance 3). */
  async open(input: { id: string; userId: string; kind: AiRequestKind }): Promise<void>;
  /** Clôt en succès, écrit le résultat, et annonce si la règle le dit. */
  async succeed(id: string, result: unknown): Promise<void>;
  /** Clôt en échec, et annonce si la règle le dit. */
  async fail(id: string, error: string): Promise<void>;
  /** Le téléphone a été posé : la réponse devra être annoncée. */
  async markLeftScreen(id: string, userId: string): Promise<void>;
  async status(id: string, userId: string): Promise<AiRequestStatusDto>;
}
```

Points d'entrée : `GET /ai-requests/:id` (la ligne d'un autre utilisateur rend
404, jamais 403 — on ne révèle pas son existence) et
`POST /ai-requests/:id/background` (appelé par `sendBeacon`, rend 204).

- [ ] **Étape 1 : écrire les tests qui échouent**

Cinq cas : une demande close sans départ de page n'annonce rien ; une demande
dont le départ a été signalé annonce une fois et une seule (`notifiedAt`) ;
`GET /ai-requests/:id` rend le résultat au retour ; la ligne d'un autre
utilisateur rend 404 ; **point de vigilance 3** — deux `open` avec le même
`id` ne créent qu'une ligne.

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

- [ ] **Étape 3 : écrire le service et le contrôleur**

- [ ] **Étape 4 : lancer les tests, vérifier le succès**

- [ ] **Étape 5 : commit** — `feat(api): lignes de demande au modèle et annonce du résultat`

---

## Tâche 5 : brancher les quatre points d'entrée

**Fichiers :**
- Modifier : `apps/api/src/recognition/scan.controller.ts:29`,
  `apps/api/src/suggestions/suggestions.controller.ts:30` et `:60`,
  `apps/api/src/receipts/receipts.controller.ts:19`
- Modifier : `packages/shared/src/schemas/notifications.ts` (le champ d'identifiant)
- Test : les quatre `*.e2e-spec.ts` existants de ces modules

- [ ] **Étape 1 : écrire les tests qui échouent**

Pour chacun des quatre : une demande portant un identifiant ouvre une ligne
`AiRequest` du bon `kind` rattachée à l'utilisateur, et la clôt avec son
résultat. Une demande sans identifiant fonctionne exactement comme avant et
n'ouvre aucune ligne — l'ancien client ne doit pas casser.

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

- [ ] **Étape 3 : ajouter le champ et l'encadrement**

L'identifiant arrive en champ `requestId` (multipart) ou en paramètre de
requête pour `GET /suggestions`, validé par `z.string().uuid().optional()`.
`GET /suggestions` n'ouvre de ligne **que** si la fournée déclenche vraiment un
appel au modèle (le plancher de six) : une ouverture d'écran ordinaire ne doit
rien ouvrir.

- [ ] **Étape 4 : lancer `npm test -w @kitchen/api`**

- [ ] **Étape 5 : commit** — `feat(api): les quatre usages du modèle ouvrent une demande (EF-25, EF-26)`

---

## Tâche 6 : le différé

**Fichiers :**
- Créer : `apps/api/src/ai-requests/deferral.service.ts`
- Test : `apps/api/src/ai-requests/deferral.e2e-spec.ts`
- Modifier : `apps/api/src/ai-requests/ai-request.service.ts`

**Interfaces — consomme :** `deferralRetryAt`, `DEFERRAL_CEILING_MS` (tâche 1) ;
`GeminiPausedError` et `GeminiQuotaError` (`apps/api/src/gemini/gemini-errors.ts`) ;
`MediaService.save` / `resolve`.

**Interfaces — produit :**

```ts
class DeferralService {
  /** Sur `GeminiPausedError` : garde l'entrée et programme le rejeu, ou abandonne. */
  async defer(input: { id: string; resumeAt: Date; input: Buffer | unknown; mimeType?: string }): Promise<{ retryAt: Date } | null>;
  /** Rejoue les demandes dont l'heure est venue. Appelée par la minuterie et au démarrage. */
  async replayDue(now: Date): Promise<void>;
  /** Clôt les lignes « en cours » orphelines d'un redémarrage (D12). */
  async closeOrphans(): Promise<void>;
}
```

L'entrée conservée va sous un préfixe dédié du volume `media`, et est effacée
dès que la demande aboutit ou est abandonnée.

- [ ] **Étape 1 : écrire les tests qui échouent**

Six cas, dont les quatre points de vigilance restants :
une pause de vingt minutes diffère et rejoue à l'heure dite, le résultat est
annoncé bien que l'écran n'ait pas été quitté (D1b) ;
une reprise au-delà d'une heure abandonne tout de suite et l'annonce (D6) ;
**vigilance 1** — une seconde demande du même usage remplace la première, sans
notification pour l'abandonnée, dont l'entrée disparaît du disque ;
**vigilance 4** — une ligne `RUNNING` présente au démarrage est close en échec,
annoncée seulement si le départ avait été signalé ;
**vigilance 5** — quota épuisé au rejeu : abandon annoncé avec sa raison,
jamais un nouveau différé ;
l'entrée conservée est effacée du disque après un rejeu réussi.

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

- [ ] **Étape 3 : écrire le service, le brancher sur les quatre points d'entrée**

La minuterie est au choix de l'exécutant, pourvu qu'un redémarrage ne perde
aucune demande en attente et qu'aucune ne soit jouée deux fois.

- [ ] **Étape 4 : lancer `npm test -w @kitchen/api`**

- [ ] **Étape 5 : commit** — `feat(api): rejouer une demande refusée pour une pause Gemini`

---

## Tâche 7 : le service worker

**Fichiers :**
- Créer : `apps/web/src/sw.ts`
- Modifier : `apps/web/vite.config.ts:18-52`
- Test : `apps/web/src/sw.test.ts`

- [ ] **Étape 1 : écrire les tests qui échouent**

Un événement `push` affiche une notification dont le titre, le corps et le
`tag` sont ceux du message ; `notificationclick` ouvre l'URL portée par le
message, ou donne le focus à un onglet déjà ouvert sur l'application.

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

- [ ] **Étape 3 : passer `VitePWA` en `strategies: 'injectManifest'` et écrire `sw.ts`**

**Le bandeau de mise à jour doit se comporter exactement comme aujourd'hui**
(D10) : proposé, jamais appliqué d'autorité. `registerType: 'prompt'` et
`injectRegister: false` sont conservés, et `sw.ts` appelle
`self.skipWaiting()` **uniquement** sur réception du message correspondant.
Reprendre `globPatterns`, `navigateFallback` et `navigateFallbackDenylist` tels
qu'ils sont.

- [ ] **Étape 4 : lancer `npm test -w @kitchen/web` et `npm run build -w @kitchen/web`**

- [ ] **Étape 5 : commit** — `feat(pwa): service worker écrit à la main, prêt pour les notifications`

---

## Tâche 8 : l'interrupteur, le retour sur l'écran, la documentation

**Fichiers :**
- Créer : `apps/web/src/lib/ai-request.ts`, `apps/web/src/screens/settings/notifications-row.tsx`
- Modifier : `apps/web/src/screens/settings/settings-screen.tsx`, les quatre écrans appelants
- Modifier : `README.md`, `docs/cahier-des-charges.md`
- Test : `apps/web/src/screens/settings/notifications-row.test.tsx`, `apps/web/src/lib/ai-request.test.ts`

**Interfaces — produit :**

```ts
/** Identifiant engendré pour une demande, gardé jusqu'à ce qu'on en ait vu le résultat. */
export function beginAiRequest(kind: AiRequestKind): string;
/** Signale le départ de page tant que la demande est en cours (`visibilitychange` + `sendBeacon`). */
export function watchAiRequest(id: string): () => void;
/** Au lancement : réclame le résultat des demandes qu'on n'a pas vues aboutir. */
export function recoverAiRequests(): Promise<AiRequestStatusDto[]>;
```

- [ ] **Étape 1 : écrire les tests qui échouent**

L'interrupteur demande l'autorisation puis enregistre l'abonnement ; refusée,
il reste éteint et le dit ; sur un appareil sans Web Push, et quand le serveur
ne rend aucune clé publique, il est éteint et désactivé avec sa raison (D11) ;
passer la page en arrière-plan pendant une demande envoie le signal, et pas
après la fin de la demande.

- [ ] **Étape 2 : lancer les tests, vérifier l'échec**

- [ ] **Étape 3 : écrire la bibliothèque, l'interrupteur, et brancher les écrans**

L'écran d'une demande différée affiche l'attente et l'heure de reprise au lieu
d'un refus sec (D1b).

- [ ] **Étape 4 : mettre à jour `README.md` et le cahier des charges**

README : une section sur la notification, la procédure d'engendrement des clés
VAPID (`npx web-push generate-vapid-keys`), les trois clés du `.env`, la
limite iOS, et la ligne de version dans « Derniers changements ».
Cahier des charges : nouvelle exigence et amendement daté en section 26,
renvoyant à la conception.

- [ ] **Étape 5 : lancer `npm test`, `npm run lint`, `npx tsc --noEmit` sur les deux applications**

- [ ] **Étape 6 : commit** — `feat(notifications): prévenir quand la réponse est prête`

---

## Relecture du plan

- **Couverture :** D1 → tâches 1 et 8 ; D1b → 1, 6, 8 ; D2 → 5 ; D3 → 2 ;
  D4 → 2, 4, 5 ; D5 → 6 ; D6 → 1, 6 ; D7 → 3 ; D8 → 8 ; D9 → 1 ; D10 → 7 ;
  D11 → 3, 8 ; D12 → 6 ; D13 → 6 ; D14 → 3 ; D15 → 6.
- **Points de vigilance :** 1 → tâche 6 ; 2 → tâche 3 ; 3 → tâche 4 ;
  4 → tâche 6 ; 5 → tâche 6. Tous portés par un test nommé.
- **Cohérence des noms :** `shouldNotify`, `deferralRetryAt`,
  `notificationPayload`, `AiRequestKind`, `AiRequestStatusDto`,
  `PushService.sendToUser`, `AiRequestService.{open,succeed,fail,markLeftScreen,status}`,
  `DeferralService.{defer,replayDue,closeOrphans}` — employés sous ces noms
  exacts d'une tâche à l'autre.
