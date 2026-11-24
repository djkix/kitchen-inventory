# Recette à la demande (EF-25, EF-26)

> Conception validée avec le propriétaire le 2026-11-24. Normatif.
> Relue par un constructeur avant remise ; les décisions prises en réponse à
> cette relecture sont signalées par **(relecture)**.

## Pourquoi

Le propriétaire a exporté son inventaire (`GET /export/inventory-prompt.json`,
livré en 0.44.0), l'a déposé dans l'application Gemini et lui a demandé
« une recette asiatique avec de la cacahuète, des échalotes et de l'ail ».
La réponse, obtenue en quelques secondes, est ce qu'il attend de son
application — et son application ne sait pas la produire. Trois écarts
l'expliquent, et aucun n'est un réglage de consigne :

1. **Gemini a vu tout le stock.** 171 lignes. L'application n'envoie que
   **huit** ingrédients (`SEED_MAX`,
   `packages/shared/src/rules/seed-selection.ts`), choisis automatiquement.
   D'où l'absence, côté application, de « tu n'as pas d'ail frais, j'ai pris de
   l'ail semoule » et de « ta purée de cacahuètes est au congélateur ».
2. **On lui demande une fournée, pas une réponse.** L'écran Suggestions
   commande *N recettes* en JSON strict. Gemini a rendu *une recette à une
   question*, avec ses remarques autour : ce qui manque et par quoi c'est
   remplacé, où un ingrédient est rangé, une variante protéinée.
3. **Nos champs ne portent pas ces remarques.** `ingredients[]` et `steps[]`
   n'ont pas de place pour « tu n'as pas d'ail frais, j'ai pris de l'ail
   semoule ».

## Ce qu'on construit

Trois chemins dans l'écran Suggestions, le geste décidant du chemin :

| Geste | Réponse |
|---|---|
| **Tu dictes** (icône micro, déjà là) | **une** recette détaillée + ses remarques |
| **Tu écris une phrase** | **une** recette détaillée + ses remarques |
| **Tu ne dis rien, tu règles les filtres** | la liste de cartes actuelle, recettes plus fournies |

Dans les trois cas, la liste complète de ce que contient le foyer part au
modèle, et les quantités portent les deux mesures : **45 ml (3 c. à soupe)**.

## Objectifs

- Une demande en langage naturel (parlée ou écrite) rend une recette unique,
  détaillée, accompagnée de remarques en français sur le stock réel.
- Le modèle connaît tout ce que le foyer possède, et non huit produits tirés au
  sort : il peut donc dire ce qui manque, par quoi il l'a remplacé, et où un
  ingrédient est rangé.
- Les quantités affichent l'équivalent ménager à côté de la mesure exacte, et
  cet équivalent suit le nombre de parts.

## Non-objectifs

- **Pas de conversation.** Une demande, une réponse. Pas de « plutôt au four »,
  pas d'historique de discussion, pas de relance sur la réponse précédente.
  Explicitement écarté par le propriétaire (« c'est bon, pas de chat »).
- **Pas de quantités ni de dates dans ce qui part au modèle** (décision du
  propriétaire, 2026-11-24). Une recette n'a pas besoin de savoir qu'il reste
  250 g de farine plutôt que 2 kg : seule la présence du produit compte. Les
  péremptions restent hors du module recettes, comme le cahier le dit depuis le
  2026-10-04.
- Pas de nouvelle route d'export : `inventory-prompt.json` reste ce qu'il est,
  à destination d'un usage manuel.
- Rien ne change dans le fonctionnement des recettes conservées (« Mes
  recettes ») : ni la cuisson, ni l'historique, ni la notation, ni le modèle
  `Recipe`. Seul l'**affichage** d'un ingrédient y gagne son équivalent ménager
  (**relecture** : le non-objectif initial était trop large, il interdisait ce
  que la spec demandait par ailleurs).
- Pas de liste de courses : EF-12 et EF-24 restent abandonnées.

## Anti-objectifs

Ce qui ferait de cette livraison un échec même si tout fonctionne :

- **Perdre les grammes.** Le propriétaire a demandé le 2026-11-21 des quantités
  toujours chiffrées en unités connues. L'équivalent ménager s'**ajoute**, il
  ne remplace jamais. Une recette qui affiche « 3 c. à soupe » seule est une
  régression.
- **Un équivalent faux après changement de parts.** Si le champ « Parts » passe
  de 4 à 6 et que l'équivalent reste celui de 4, mieux vaut ne rien afficher.
- **Des remarques inventées.** « Tu n'as pas d'ail frais » doit être vrai au
  moment de la demande.
- **Une dépense qui dérape.** Un chemin qui appellerait le modèle sans passer
  par le quota journalier ou le plafond mensuel.
- **Un appel payé pour rien.** Une demande qui consomme le quota et ne laisse
  aucune recette à l'écran (**relecture**, voir « Une recette, toujours »).

## Contraintes

Héritées du cahier des charges et des livraisons précédentes :

- Règles métier en fonctions pures testées dans `packages/shared` (section 15).
- Schémas Zod définis une seule fois dans `packages/shared`, réutilisés côté front.
- Anglais pour le code, français pour les libellés et les messages d'erreur.
- TypeScript strict, `any` interdit hors tests.
- Aucun test ne dépend du réseau : Gemini et Open Food Facts rejoués depuis des
  fixtures (`e2e/fixtures/stub-server.ts` pour les parcours bout en bout).
- Tout appel au modèle passe par `GeminiService.call` : choix du modèle,
  limites par minute et par jour, pause après 429/503, journal `GeminiCall`.
- Quota journalier `RECIPE_SUGGESTION_DAILY_QUOTA` (20) et plafond mensuel
  `VISION_MONTHLY_CAP_CENTS` (5 €), partagés avec le scan.
- Les écritures passent par `POST`, derrière la garde des écritures
  inter-origines (`csrf.middleware.ts`).
- README mis à jour en français dans le même commit, ligne de changelog ajoutée.

## Amendement du cahier des charges

À porter dans le même lot, section 26, daté du 2026-11-24 :

- **Section 12 et EF-26** : « À partir d'une sélection d'ingrédients composée
  automatiquement depuis le stock » devient : à partir de la liste des produits
  présents dans le foyer, sans quantités ni dates.
- **Section 12, amendement du 2026-10-04 sur la péremption** : confirmé, pas
  touché. Les dates restent hors du module recettes.
- **Section 12** : la demande en langage naturel, parlée ou écrite, rend une
  recette unique et non une fournée.

## Approches considérées

### 1. La forme de la réponse « une recette + les remarques »

| Approche | Ce qu'elle coûte |
|---|---|
| **Un appel, un JSON** — la recette dans les champs habituels, plus un bloc de texte libre. | Rien de neuf dans le stockage des recettes, le bouton « conserver » marche tel quel, un seul appel payant. |
| Un vrai chat — relances possibles. | Conversation à stocker, écran de discussion, chaque relance repaie l'historique. |

**Retenu : un appel, un JSON.** Le propriétaire n'a pas demandé à discuter mais
une bonne réponse du premier coup. Le chat pourra se greffer plus tard.

### 2. L'équivalent ménager (45 ml / 3 c. à soupe)

| Approche | Ce qu'elle coûte |
|---|---|
| Un champ de plus, rempli par le modèle. | Le « 3 c. à soupe » stocké devient faux dès que « Parts » change ; un jeton de plus par ingrédient ; rien pour les recettes déjà au réservoir. |
| **Calculé chez nous**, fonction pure dans `packages/shared`. | Aucune migration, suit les parts tout seul, s'applique aux ~400 recettes déjà au réservoir. |

**Retenu : calculé chez nous.** Décision prise contre une première annonce
erronée de ma part (un champ stocké), corrigée en séance.

### 3. Ce qu'on envoie du foyer

| Approche | Ce qu'elle coûte |
|---|---|
| Garder les huit graines de `pickSeedIngredients`. | Pas de remarques possibles : ni « tu n'as pas d'ail frais », ni l'emplacement. |
| L'export complet tel quel (`promptInventory`). | Porte les quantités et les péremptions, que le propriétaire ne veut pas envoyer. |
| **La liste des produits et leur emplacement**, sans quantités ni dates. | ~170 lignes très courtes. Suffit à tout ce qu'on attend des remarques. |

**Retenu : la liste des produits et leur emplacement**, dans les trois chemins.
`pickSeedIngredients` et `loadSeedCandidates` n'ont alors plus d'appelant.

## Ce qui est décidé

### Une seule forme de recette, enrichie d'un champ

`modelRecipeSchema` (`packages/shared/src/schemas/suggestions.ts`) gagne
**`notes: string | null`** : quelques phrases en français sur cette recette face
au stock réel — substitutions faites et pourquoi, où un ingrédient est rangé
s'il surprend, une variante si elle vaut la peine. Jamais de date de péremption.

Le champ vit dans la `payload Json` de `SuggestionPoolRecipe` : **aucune
migration de ce côté**. Il est optionnel à la lecture, les ~400 lignes
existantes n'en portant pas, et la revalidation à chaque lecture
(`toPoolRecipe`) ne doit pas les écarter.

**`SuggestionDto` porte `notes` lui aussi** (**relecture** : sans quoi l'écran
ne peut rien afficher).

Le même champ sert les trois chemins. Pour la liste filtrée, c'est précisément
ce qui rend les cartes « plus riches ». **À dire sans détour** : les ~400
recettes déjà au réservoir resteront sans remarques, aucun rattrapage n'est
prévu. L'enrichissement de la liste ne vaut que pour ce qui arrive ensuite.

### Le chemin « une recette »

Deux entrées, une même forme de réponse :

- **Parlée** : `POST /suggestions/voice` existe déjà (multipart, champ `audio`,
  borné à 60 s et 4 Mo par `voiceAudioRejection`). Elle rendait une fournée ;
  elle rend désormais `{ heard, recipe }`.
- **Écrite** : une route sœur, corps JSON, portant la phrase telle qu'elle a
  été tapée. Elle rend `{ heard, recipe }` également (**relecture**) : `heard`
  n'est pas affiché sur ce chemin, mais il alimente le champ `declared` des
  ingrédients, sans quoi un ingrédient nommé dans la phrase et absent du stock
  s'afficherait « Manquant » — le défaut que D5 du 2026-10-19 avait corrigé
  pour la voix.

`recipe` est un **`SuggestionDto`** (**relecture**), donc déjà rapproché du
stock et porteur de son `suggestionIdentity` : `SuggestionCard`,
`SuggestionSheet` et `POST /suggestions/keep` s'appliquent sans modification.
`notes` est **dans** la recette, pas à côté.

Les deux entrées consomment le quota journalier et le plafond mensuel, passent
par `DeferralService.track`, et **partagent le même compartiment** de cinq
appels par minute par adresse (**relecture** : deux compartiments séparés
feraient dix).

**Un `AiRequestKind` nouveau** — `RECIPE_REQUEST` — avec sa **migration Prisma**
(**relecture**). Réutiliser `SUGGESTIONS` était tentant pour éviter la
migration, mais son rejoueur (`suggestions.controller.ts`, `onModuleInit`)
appelle `suggestions.list()` et rendrait une fournée au rejeu d'une demande
différée. Le nouveau genre entraîne avec lui `SCREENS`, `BODIES`, `title()` et
`CARRIES_ID` (`packages/shared/src/rules/ai-requests.ts`).

### Une recette, toujours

**Le chemin « une recette » force `provenance: 'ai'`** (**relecture**). Une
recette `web` est jetée par `SuggestionPoolService.ingestOne` quand la page est
illisible, et jetée sans lecture quand `suggestionWebSearch` est éteint — ce
qui est le cas aujourd'hui en production. Avec une seule recette demandée, un
appel payé pouvait ne rien laisser à l'écran. Pas de recherche web sur ce
chemin, donc pas de page à lire, donc rien à jeter.

La recette rendue **entre au réservoir** comme celles d'une fournée,
dédoublonnée par `suggestionIdentity`, `notes` comprises.

Si la phrase ne demande pas une recette, ou que le modèle ne rend rien
d'exploitable, la réponse le dit en français plutôt que de rendre une recette
de remplissage.

**Les remarques ne survivent pas à la conservation** (**relecture**) : le modèle
`Recipe` n'a pas de champ pour elles et n'en gagne pas. C'est voulu — une
remarque décrit le stock au moment de la question, elle est fausse une semaine
plus tard.

### Le champ de texte libre

`apps/web/src/screens/suggestions/ingredients-field.tsx` — le champ à pastilles
d'aujourd'hui — devient un champ de texte libre : on y tape une phrase entière,
elle part telle quelle au modèle.

**L'arbitrage des deux chemins côté écran** (**relecture**) : le bouton
« Chercher » part vers la route « une recette » **si le champ porte du texte**,
et vers la fournée (`POST /suggestions`) s'il est vide. La barre d'orientation
déclenche la fournée comme aujourd'hui.

**Ce qui disparaît avec les pastilles** (**relecture** : la spec initiale ne
citait que `buildSuggestionPrompt`) :

- `suggestionIngredientsSchema`, `SuggestionQuery.ingredients`,
  `PoolFilter.ingredients`, `recipeUsesAllTerms`,
  `packages/shared/src/rules/suggestion-ingredients.ts` ;
- la notion d'« ingrédients imposés » de `buildSuggestionPrompt` ;
- dans `voice-request-screen.tsx`, le bouton **« Proposer d'autres recettes »**,
  bâti sur `heard.ingredients` + `suggestionsApi.list({ ingredients })` ;
- **`SUGGESTION_SIGNATURE_VERSION` passe de `v5` à `v6`** : `v5` avait été
  créée pour inclure ces ingrédients dans la signature d'orientation ; sans
  changement de version, les lignes `SuggestionBatch` existantes désigneraient
  une orientation qui n'existe plus.

Le champ `declared` de `SuggestionIngredientDto`, lui, **reste** : il est
désormais alimenté par `heard` sur les deux entrées.

L'écran de réponse est commun aux deux entrées ; la version parlée
(`voice-request-screen.tsx`) montre en plus ce qui a été entendu.

### Les filtres seuls

Inchangés dans leur fonctionnement : question bloquante de type de plat, barre
d'orientation (type, région, durée, difficulté), réservoir, plancher de six
recettes, relance explicite, signature d'orientation. Ce qui change est la
matière : la liste des produits du foyer au modèle, et `notes` sur chaque
recette.

**Le chemin « une recette » ignore tout cela** (**relecture**) : pas de
plancher `SUGGESTION_POOL_FLOOR`, pas de `SAME_ORIENTATION_TTL_MS`, pas de
`knownTitles`, pas de ligne `SuggestionBatch` — comme `listFromVoice`
aujourd'hui. Une question posée appelle le modèle, toujours.

### L'équivalent ménager

Fonction pure dans `packages/shared` (**relecture** : là et non dans
`quantity-ui.ts`, la contrainte de la section 15 primant ; le français
d'interface y vit déjà, `UNIT_LABELS_FR` est dans `units.ts`). Elle prend une
quantité et une unité et rend un libellé ou `null` :

- `PIECE`, `PACK`, `BOX`, `SACHET` : `null`, rien à convertir.
- Volumes (`MILLILITER`, `LITER`) et masses (`GRAM`, `KILOGRAM`) : cuillère à
  soupe = 15 (ml ou g), cuillère à café = 5. Ce sont les équivalences que le
  modèle emploie lui-même, écrites dans `MEASUREMENT_RULE`.
- **Choix de la cuillère** (**relecture**) : café en dessous de 15, soupe à
  partir de 15.
- **Seuil bas** : rien en dessous de 2,5 (une demi-cuillère à café).
- **Seuil haut** : rien au-delà de 8 cuillères à soupe, soit 120. « 250 g » ne
  se lit pas « 16 c. à soupe ».
- Arrondi au demi : « 1 c. à soupe », « 1,5 c. à soupe », « 2 c. à café ».

**Où il s'affiche** : dans les contextes recette uniquement —
`apps/web/src/screens/recipe/ingredient-row.tsx`,
`apps/web/src/screens/recipe/cook-sheet.tsx`,
`apps/web/src/screens/suggestions/suggestion-sheet.tsx`. **Jamais sur le stock** :
`formatQuantity` (`apps/web/src/lib/quantity-ui.ts`) est partagée avec les écrans
Stock, Article, Scan et Périme bientôt, qui n'ont que faire de cuillères. C'est
donc une fonction distincte, pas une modification de `formatQuantity`.

Comme il est calculé à l'affichage, il suit `scaleIngredients` et le champ
« Parts » sans rien de plus.

`MEASUREMENT_RULE` reste en l'état : le modèle continue de rendre des grammes et
des millilitres, l'équivalent ménager est une affaire d'affichage.

### Ce qu'on envoie du foyer

La liste des produits présents, avec leur emplacement. **Ni quantité, ni date.**

Elle ne vient donc **pas** de `promptInventory` (**relecture** : cette fonction
consomme des `ExportRow` produits par une méthode privée du contrôleur
d'export, et porte précisément les deux champs qu'on ne veut pas). Elle est
construite dans le module suggestions, à partir des lots actifs : un produit
par ligne, dédoublonné, archives exclues.

**Un produit rangé à deux endroits cite ses deux emplacements** (**relecture** :
`promptInventory` n'en gardait qu'un, celui du premier lot — la promesse « ta
purée de cacahuètes est au congélateur » n'aurait tenu qu'à moitié).

**L'inventaire vide** (**relecture**) : `SuggestionsService.list` lève
aujourd'hui `insufficientStock` quand `pickSeedIngredients` ne rend rien. La
garde reste, sur un critère devenu plus simple — aucun produit en stock —,
mais **sur le seul chemin filtré** (amendé en exécution le 2026-11-24, validé
par le propriétaire) : une demande écrite ou parlée porte ses propres
ingrédients, et la refuser sur un placard vide serait moins utile que de
laisser le modèle composer à partir de la phrase. Le chemin filtré, lui, n'a
rien d'autre pour composer sa question.

## Ce qui est laissé au constructeur

- La mise en page de l'écran de réponse : où vont les remarques par rapport à la
  recette, comment la phrase demandée est rappelée.
- Le nom et la forme exacte de la route écrite, et le nom de la fonction
  d'équivalent ménager.
- La forme du libellé (« c. à soupe » ou « cuillère à soupe »).
- La longueur maximale acceptée pour `notes` et pour la phrase tapée.
- Le découpage des consignes dans `prompt.ts` : la consigne d'une recette unique
  partage-t-elle `QUALITY_RULES` avec les fournées, ou en reçoit-elle une variante.
- Les parcours bout en bout à ajouter ou à modifier (P5 couvre Suggestions).

## Ce qu'il faut penser à vérifier

- Les ~400 recettes du réservoir n'ont pas de `notes` : elles doivent continuer
  de se lire et de s'afficher.
- `POST /suggestions/voice` change de forme de réponse.
  `VoiceSuggestionBatchDto` étend aujourd'hui `SuggestionBatchDto` (items,
  poolCount, notice) : `voice-request-screen.tsx`, ses tests et la doublure
  Gemini suivent. **Les résultats de demandes différées déjà écrits en base
  portent l'ancienne forme** et sont relus tels quels
  (`status.result as VoiceSuggestionBatchDto`) : à traiter, pas à découvrir en
  production.
- `pickSeedIngredients`, `loadSeedCandidates`, `SEED_MAX` et leurs tests perdent
  leur appelant : à supprimer, pas à laisser mourir en silence.
- **La doublure Gemini des parcours bout en bout** (`e2e/fixtures/stub-server.ts`)
  route sur un seul critère : `isSuggestionRequest = !isVisionRequest`, et sert
  toujours `suggestions/gemini-batch.json`. Une demande « une recette » y est
  indiscernable d'une fournée : il faut un nouveau discriminant et une nouvelle
  fixture. À noter aussi : une demande **parlée** porte un `inlineData` et tombe
  donc aujourd'hui dans la branche vision — la voix n'est pas couverte bout en
  bout.
- Le prompt grossit d'environ 170 lignes courtes : les limites par minute en
  jetons (`GeminiService`) doivent rester tenues.
