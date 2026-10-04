# Recettes suggérées à partir du stock

2026-10-04 · Franck, avec assistance de Claude · révision 2, dix-sept arbitrages intégrés

Spécification du deuxième incrément du module recettes : **partir du stock réel et proposer des
recettes trouvées sur le web ou composées par Gemini**, catégorisées par origine, durée et facilité,
et conservables d'un geste dans la bibliothèque du foyer, au format unique de l'application.

Le document de référence `docs/cahier-des-charges.md` a été amendé le 2026-10-04 pour acter cette
approche : la suggestion assistée devient la porte d'entrée du module (section 12, EF-25, EF-26),
et EF-27 est retirée.

Cette spécification s'appuie sur le socle livré en 0.7.0
(`docs/specs/2026-10-03-module-recettes-socle.md`, arbitrages **[A1]** à **[A27]**) : instantané de
stock, couverture, cuisson avec décrément, historique et notation sont réutilisés tels quels. Les
décisions propres à cet incrément sont notées **[B1]** à **[B17]** et récapitulées en annexe.

## 1. Intention

Le socle a livré un carnet de recettes que le foyer remplit lui-même, avec le stock comme filtre.
Ce n'est pas la question posée. La question posée est : **« j'ai des spaghettis et de la sauce
tomate, qu'est-ce que je fais ? »** — et la réponse doit venir du web, pas d'un carnet qu'il
faudrait d'abord écrire.

Le stock devient le **point de départ** de la suggestion. La bibliothèque subsiste, se remplit par un
choix recette après recette, et vaut comme mémoire de ce qui a marché. **[B1]**

Le succès se mesure sur un scénario figé **[B16]** : un stock défini, une réponse de Gemini
enregistrée en fixture, et le résultat attendu écrit d'avance — ingrédients de départ retenus,
rapprochement de chaque ingrédient au stock, catégorisation.

## 2. Périmètre

### Dans cet incrément

- Composition automatique du point de départ à partir du stock.
- Appel à Gemini, deux sources cumulées : recherche web réelle, et composition par le modèle.
- Orientation par région, durée ou facilité, qui **relance une recherche ciblée**.
- Rapprochement des ingrédients de la recette avec les produits de l'inventaire.
- Écran **Suggestions**, qui devient l'écran d'entrée du module.
- Conservation d'une suggestion : extraction de la page, réécriture au format de l'application.
- Mise en cache des fournées, quota et plafond de dépense partagés avec la reconnaissance photo.
- Retrait de la création manuelle et de toute notion de péremption dans le module.

### Hors de cet incrément, et pourquoi

- **La création d'une recette à la main [B13].** Franck ne veut pas saisir de recettes. Le formulaire
  reste accessible pour **modifier une recette conservée**. Conséquence assumée : la recette de
  famille, absente du web, n'a pas sa place dans l'application.
- **L'ajout des manquants à la liste de courses** (EF-24) : la liste de courses n'existe pas encore.
- **Le classement des suggestions par la note du foyer.** Une suggestion n'a pas d'historique : elle
  arrive dans l'ordre rendu par le modèle. Le tri par note continue de régir la bibliothèque.
- **La photo de la recette.** Les vignettes des sites tiers ne sont pas reprises.

## 3. Le parcours

1. Franck ouvre **Suggestions**, écran d'entrée du module **[B12]**.
2. L'application compose le point de départ depuis le stock, sans le lui montrer **[B2]**.
3. Si une fournée en cache correspond, elle s'affiche immédiatement ; sinon Gemini est interrogé.
4. La fournée s'affiche : une carte par recette — titre, origine, durée, facilité, couverture,
   manquants, provenance. **Pas d'étapes, quelle que soit la source [B7].**
5. Franck oriente par région, durée ou facilité : **une recherche ciblée est relancée [B9]**.
6. Une recette lui plaît : il la conserve. La page est alors récupérée et réécrite au format de
   l'application **[B6]**, et la recette entre dans **Mes recettes**.
7. De là, le socle reprend la main : cuisson avec décrément, historique, notation.

## 4. Composition du point de départ

Une fonction pure de `packages/shared`, testée, qui reçoit l'instantané de stock déjà construit par
`RecipesCoverageService` et rend la liste des ingrédients de départ.

**Règles :**

1. **Huit ingrédients au maximum [B3].** Au-delà, le modèle choisit lui-même trois aliments dans le
   tas et rend des recettes tièdes ; en deçà de cinq, les propositions tournent en rond.
2. **Cinq places stables, trois tournantes [B4].** Les cinq aliments les plus structurants du stock
   occupent les premières places ; les trois dernières tournent d'un jour à l'autre parmi les
   suivants, pour que les suggestions se renouvellent sans que le stock ait à changer. La rotation
   est déterministe, fonction du jour, afin que deux ouvertures le même jour donnent le même
   résultat.
3. **Aucun rôle de la péremption [B5].** Les dates n'interviennent ni dans la sélection, ni dans
   l'ordre, ni par une mention à l'écran. Le suivi des péremptions reste entier dans l'écran
   « Périme bientôt ».
4. **Exclusions [B5] :** les épices, le sel et le poivre ne sont jamais retenus — ils ne décrivent
   pas un repas et sont presque toujours en stock. **L'huile et le vinaigre restent éligibles**,
   parce qu'ils font des plats. L'exclusion porte sur la catégorie du produit, par une liste nommée
   dans `packages/shared` (`NON_STRUCTURING_CATEGORIES`), modifiable sans toucher au code appelant.

L'exclusion ne porte que sur la requête : ces produits restent comptés dans « ce qui te manque » et
restent décrémentés à la cuisson.

La signature de la sélection — les identifiants retenus, triés, plus la date de rotation — sert de
clé de cache.

## 5. Les deux sources

### 5.1 Recherche web réelle

Gemini est appelé avec la recherche Google activée. Il rend, par recette : titre, URL, origine,
durée, difficulté et liste d'ingrédients.

**Objectif de composition : huit recettes du web sur douze [B8]**, le reste composé par le modèle.
Ce n'est pas un quota rigide : si la recherche ne rend que cinq recettes exploitables, on complète
par des compositions plutôt que de servir une fournée maigre, et inversement.

**Aucune variété n'est imposée au modèle [B9].** Il rend ce qu'il juge le meilleur. La variété n'a
pas à être forcée puisque toute orientation relance une recherche ciblée (section 6).

### 5.2 Composition par Gemini

Le même appel demande des recettes composées par le modèle, utiles quand le stock est trop
particulier pour que la recherche donne quelque chose. Elles portent une mention visible
« proposée par l'IA ». Une proportion inventée est un risque assumé et annoncé, jamais masqué.

### 5.3 Ce qui est affiché avant la conservation

**Les deux sources se présentent à l'identique [B7]** : titre, origine, durée, facilité, ingrédients,
ce qui manque, provenance. **Aucune étape**, même pour une recette composée dont les étapes sont
pourtant déjà disponibles — sans quoi la moitié des fiches serait bavarde et l'autre muette, et
l'œil se porterait sur les recettes IA parce qu'elles en disent plus, non parce qu'elles sont
meilleures.

### 5.4 Validation

Le modèle répond en JSON contraint par un schéma. Toute réponse qui ne valide pas le schéma Zod est
rejetée : aucune donnée du modèle n'entre dans l'application sans validation **[B17]**, au même titre
qu'une saisie utilisateur.

## 6. Orientation : une recherche ciblée, jamais un masquage

Choisir une orientation **relance une requête** auprès de Gemini, sur les trois dimensions **[B9]** :

| Dimension | Grain | Comportement |
| --- | --- | --- |
| Origine | **région** (asiatique, européenne, méditerranéenne, latino-américaine…) | recherche ciblée sur la région |
| Durée | ≤ 15, ≤ 30, ≤ 60 min | recherche ciblée sur la durée |
| Facilité | les quatre niveaux du cahier | recherche ciblée sur le niveau |

Le choix se fait au grain de la **région**, pas du pays **[B10]** : peu de boutons, un geste rapide.
La carte continue d'afficher le pays quand il est connu — « italienne », « thaïlandaise » — parce
que c'est une information utile ; c'est seulement le choix qui est régional.

Le résultat de chaque recherche ciblée est mis en cache comme la fournée de base, de sorte que
revenir sur une orientation déjà vue est instantané et gratuit.

## 7. Rapprochement des ingrédients au stock

C'est le point dur : de ce rapprochement dépend tout l'affichage de ce qui manque.

Une fonction pure de `packages/shared` reçoit le libellé rendu par la recette et le catalogue des
produits, et rend un état :

| État | Règle | Affichage |
| --- | --- | --- |
| **Sûr** | le nom normalisé est identique à celui d'un produit | le produit, sans mention |
| **Probable** | similarité trigramme au-dessus du seuil | « crème → *Crème fraîche épaisse 30%* », marqué comme probable |
| **Absent** | aucun candidat au-dessus du seuil | traité comme manquant |

La normalisation réutilise `normalizeProductName`, et la similarité l'extension `pg_trgm` avec
`unaccent_lite()`, toutes deux en place depuis le lot 1.

Un rapprochement probable **ne bloque pas et ne demande rien** **[B11]** : il compte comme disponible
pour la couverture, il est signalé comme probable, et c'est au moment de cuisiner — dans le tiroir
qui existe déjà — que Franck confirme ou change le produit. Le seuil de similarité est fixé à
**0,40** et sera calibré sur le scénario figé.

Une fois les produits résolus, **la couverture est calculée par les règles existantes**, sans
réimplémentation : `recipeCoverage` et ses groupes s'appliquent tels quels.

## 8. Conservation d'une recette

Au moment où Franck conserve une suggestion, et à ce moment seulement **[B6]** :

1. Pour une recette venant d'un site : la page est récupérée (HTTPS seul, délai maximal de
   5 secondes), ses données structurées `schema.org/Recipe` lues quand elles existent **[B14]**, et
   son contenu — ingrédients et étapes — soumis à Gemini, qui le **restitue au format unique de
   l'application**. L'application ne renvoie jamais vers le site.
2. Pour une recette composée : les étapes déjà rendues sont reprises telles quelles.
3. La **difficulté est recalculée** par `computeDifficulty` à partir des étapes désormais connues et
   du temps actif **[B15]**. Avant conservation, la carte affiche la difficulté annoncée par la
   source ; après, celle du barème du foyer. Elle peut donc bouger d'un cran, et c'est voulu : deux
   recettes de la bibliothèque doivent être comparables entre elles. Ce recalcul est local, gratuit
   et instantané.
4. La recette est créée avec `source = IMPORTED` ou `GENERATED`, `sourceUrl` renseignée pour la
   première, et ses ingrédients rattachés aux produits rapprochés ou laissés en texte libre.

Si la page ne répond pas ou n'est pas exploitable, la conservation échoue avec un message français
et la suggestion reste dans la fournée.

## 9. Cache, fraîcheur et coût

Une fournée — de base ou ciblée — est enregistrée avec la signature de son point de départ et de son
orientation. Elle est réutilisée tant que la signature est inchangée, et au plus **24 heures**.
Franck force une nouvelle fournée en tirant l'écran vers le bas. **[B12]**

Les appels passent par le **même journal de coûts et le même plafond mensuel** que la reconnaissance
photo : `RecognitionLog` reçoit une colonne `purpose` (`VISION` ou `RECIPE_SUGGESTION`), le plafond
`VISION_MONTHLY_CAP_CENTS` devient le plafond de l'ensemble des appels au modèle, et un quota
journalier propre aux suggestions (`RECIPE_SUGGESTION_DAILY_QUOTA`, défaut **20**) évite
l'emballement. Le plafond de production passe de 2 € à **5 €** par mois.

Plafond atteint : l'écran le dit en français, affiche la dernière fournée connue, et n'appelle plus.

## 10. Écrans

### Suggestions — écran d'entrée du module

Une liste de cartes. Chaque carte porte le titre, l'origine, la durée, la facilité, la pastille de
groupe et le taux de couverture, ce qui manque, et la provenance : nom du site, ou « proposée par
l'IA ». **Aucune mention de péremption.**

Trois rangées d'orientation : région, durée, facilité. Chaque changement relance une recherche et
affiche une attente explicite.

États à traiter, chacun avec son message français : fournisseur d'IA non configuré, stock
insuffisant pour composer une requête, attente de la réponse du modèle, échec du modèle, plafond
atteint, aucun résultat pour l'orientation demandée.

Sans fournisseur configuré (`VISION_PROVIDER=none`), l'écran ne tente aucun appel : il explique
qu'une clé est nécessaire et renvoie vers **Mes recettes**.

### Fiche d'une suggestion

Ingrédients avec leur état et le détail des manquants. Pas d'étapes. Une action : **conserver**.

### Mes recettes

L'écran de liste du socle, **moins** le bouton de création, **moins** le tri « anti-gaspillage » et
la mention associée **[B5]**. Il reste quatre tris : note (défaut), couverture, les plus faites, les
moins récentes. Cuisson, historique, notation à sept jours et étiquettes sont conservés tels quels.

### Fiche recette, tiroir de cuisson, formulaire

Inchangés. Le formulaire n'est plus atteignable qu'en modification.

## 11. Modèle de données

| Entité | Évolution |
| --- | --- |
| `SuggestionBatch` | **nouvelle** : signature du point de départ et de l'orientation, date, charge utile JSON validée, coût, modèle utilisé |
| `RecognitionLog` | colonne `purpose` (`VISION` par défaut, `RECIPE_SUGGESTION`) |
| `Recipe` | inchangé : `source` (`IMPORTED` ou `GENERATED`) et `sourceUrl` existent déjà |
| `RecipeIngredient` | inchangé |

Toute évolution passe par une migration Prisma versionnée et commitée.

## 12. Tests

- **Aucun appel réseau [B17] :** réponses de Gemini et pages web rejouées depuis des fixtures.
- Fonctions pures : composition du point de départ (dont la rotation déterministe), exclusions,
  rapprochement au stock — testées isolément.
- Fixtures de pages réelles : une avec `schema.org/Recipe` complet, une sans, une qui n'est pas une
  recette, une qui dépasse le délai.
- Réponses du modèle : une conforme, une invalide au schéma, une vide.
- **Scénario figé [B16] :** stock défini, fixture définie, résultat attendu écrit d'avance.
- Bout en bout : conserver une suggestion, puis la cuisiner, et vérifier que le stock a bougé.

## 13. Ce que cette spécification ne tranche pas

- Le modèle Gemini exact et son tarif : à fixer à l'implémentation, en réutilisant la configuration
  du fournisseur de vision.
- La liste définitive des catégories non structurantes, et celle des régions proposées à l'écran :
  listes de départ à ajuster à l'usage.
- Le seuil de similarité de 0,40 : à calibrer sur le scénario figé.
- La conduite à tenir si un site interdit la récupération automatique de ses pages : la première
  version se contente du délai et de l'échec silencieux.

## Annexe : arbitrages du 2026-10-04

| Réf | Arbitrage |
| --- | --- |
| B1 | Le stock est le point de départ ; la bibliothèque se remplit par choix |
| B2 | Le point de départ est composé par l'application et n'est pas montré à l'écran |
| B3 | Au plus huit ingrédients de départ |
| B4 | Cinq places stables, trois tournantes chaque jour |
| B5 | Aucune péremption dans le module ; exclusion des épices, du sel et du poivre ; huile et vinaigre éligibles |
| B6 | La page est extraite et réécrite au format de l'application **à la conservation**, jamais de renvoi vers le site |
| B7 | Présentation identique des deux sources avant conservation, sans étapes |
| B8 | Objectif de huit recettes web sur douze, non rigide |
| B9 | Aucune variété imposée ; toute orientation relance une recherche ciblée, sur les trois dimensions |
| B10 | L'origine se choisit par région ; la carte affiche le pays |
| B11 | Un rapprochement probable ne bloque pas ; il se confirme à la cuisson |
| B12 | « Suggestions » devient l'écran d'entrée ; fournées en cache 24 heures |
| B13 | Plus de création manuelle ; le formulaire ne sert qu'à modifier |
| B14 | Les ingrédients d'une page viennent de `schema.org/Recipe`, Gemini en repli |
| B15 | La difficulté est recalculée par le barème du foyer à la conservation |
| B16 | Scénario de réussite figé, écrit d'avance |
| B17 | Réponses du modèle validées par Zod ; aucun test ne dépend du réseau |
