# Recettes suggérées à partir du stock

2026-10-04 · Franck, avec assistance de Claude · révision 1

Spécification du deuxième incrément du module recettes : **partir du stock réel et proposer des
recettes trouvées sur le web ou composées par Gemini**, catégorisées par origine, durée et facilité,
filtrables sans nouvelle requête, et conservables d'un geste dans la bibliothèque du foyer.

Le document de référence reste `docs/cahier-des-charges.md`. Cette spécification s'en écarte sur un
point majeur, signalé en section 13 : elle inverse l'ordre de priorité des sources de recettes. Cet
écart est à acter par un amendement du cahier avant le début des travaux.

Elle s'appuie sur le socle livré en 0.7.0 (`docs/specs/2026-10-03-module-recettes-socle.md`,
arbitrages **[A1]** à **[A27]**) : instantané de stock, couverture, cuisson avec décrément,
historique et notation sont réutilisés tels quels. Les décisions propres à cet incrément sont notées
**[B1]** à **[B20]** et récapitulées en annexe.

## 1. Intention

Le socle a livré un carnet de recettes que le foyer remplit lui-même, avec le stock comme filtre.
Ce n'est pas la question posée. La question posée est : **« j'ai des spaghettis et de la sauce
tomate, qu'est-ce que je fais ? »** — et la réponse doit venir du web, pas d'un carnet qu'il
faudrait d'abord écrire.

Le stock devient donc le **point de départ** de la suggestion, et non un filtre appliqué à une
bibliothèque préexistante. La bibliothèque subsiste, mais elle se remplit par un choix, recette
après recette, et vaut comme mémoire de ce qui a marché. **[B1]**

Le succès se mesure sur un scénario figé **[B19]** : un stock défini, une réponse de Gemini
enregistrée en fixture, et le résultat attendu écrit d'avance — ingrédients de départ retenus,
rapprochement de chaque ingrédient au stock, catégorisation, répartition de la fournée.

## 2. Périmètre

### Dans cet incrément

- Composition automatique du point de départ à partir du stock.
- Appel à Gemini, en deux modes cumulés : recherche web réelle, et composition par le modèle.
- Lecture des données structurées `schema.org/Recipe` des pages trouvées, pour obtenir des
  ingrédients fiables.
- Rapprochement des ingrédients de la recette avec les produits de l'inventaire, avec un état
  « probable » qui ne bloque pas.
- Catégorisation par origine, durée et facilité ; filtrage instantané sur la fournée.
- Écran **Suggestions**, qui devient l'écran d'entrée du module.
- Conservation d'une suggestion dans la bibliothèque, en une action.
- Mise en cache des fournées, quota et plafond de dépense partagés avec la reconnaissance photo.

### Hors de cet incrément, et pourquoi

- **La création d'une recette à la main.** Le bouton de création disparaît : Franck ne veut pas
  saisir de recettes. Le formulaire reste accessible pour **ajuster une recette conservée**. **[B2]**
- **L'ajout des manquants à la liste de courses** (EF-24) : la liste de courses n'existe pas encore.
- **Le classement des suggestions par la note du foyer.** Une suggestion n'a pas d'historique : elle
  arrive dans l'ordre rendu par le modèle. Le tri par note continue de régir la bibliothèque.
- **La photo de la recette.** Les vignettes des sites tiers ne sont pas reprises.

## 3. Le parcours

1. Franck ouvre **Suggestions**.
2. L'application compose le point de départ depuis le stock, sans le lui montrer **[B3]**.
3. Si une fournée en cache correspond à ce point de départ, elle est affichée immédiatement.
   Sinon, Gemini est interrogé.
4. La fournée s'affiche : une carte par recette, avec son origine, sa durée, sa facilité, ce qui
   manque, et la mention de sa provenance.
5. Franck filtre par origine, durée ou facilité. **Aucune nouvelle requête** : le filtrage porte sur
   la fournée déjà reçue **[B10]**.
6. Une recette lui plaît : il la conserve. Elle entre dans **Mes recettes**.
7. De là, le socle reprend la main : cuisson avec décrément, historique, notation.

## 4. Composition du point de départ

Une fonction pure de `packages/shared`, testée, qui reçoit l'instantané de stock déjà construit par
`RecipesCoverageService` et rend la liste des ingrédients de départ.

**Règles**, dans l'ordre :

1. Les produits dont un lot est proche de la péremption passent devant **[B4]**. C'est le croisement
   qui a le plus de valeur au quotidien, et il reste acquis : seule son exposition à l'écran a été
   retirée.
2. Viennent ensuite les produits les plus structurants, c'est-à-dire ceux dont la catégorie porte un
   repas : féculents, protéines, légumes, bases de sauce.
3. Les condiments et assaisonnements sont **exclus** : ils ne décrivent pas un repas et noient la
   requête. L'exclusion se fait sur la catégorie, par une liste nommée dans `packages/shared`
   (`NON_STRUCTURING_CATEGORIES`), modifiable sans toucher au code appelant **[B5]**.
4. La sélection est plafonnée à **huit ingrédients** **[B6]**. Au-delà, le modèle produit des
   recettes tièdes qui n'utilisent rien de précis.

La signature de cette sélection — les identifiants de produits retenus, triés — sert de clé de cache.

## 5. Les deux sources

### 5.1 Recherche web réelle

Gemini est appelé avec la recherche Google activée. Il rend, pour chaque recette : titre, URL de la
page, origine, durée, difficulté estimée et liste d'ingrédients.

Pour chaque URL retenue, l'application **récupère la page et lit les données structurées
`schema.org/Recipe`** quand elles existent **[B7]**. C'est la source la plus fiable des ingrédients,
bien meilleure que le résumé du modèle, et c'est le mécanisme que le cahier prévoyait déjà pour
l'import par URL (EF-25). Si la page n'en a pas, ou ne répond pas, la liste rendue par Gemini sert
de repli, et la carte le signale.

Garde-fous : HTTPS uniquement, délai maximal de 5 secondes par page, trois pages récupérées en
parallèle au plus, et toute page qui n'est pas une recette est écartée silencieusement.

**Droit d'auteur.** Les étapes d'une page tierce ne sont **ni affichées, ni stockées** **[B8]**. La
carte montre le titre, les catégories, les ingrédients et ce qui manque — des faits — puis renvoie
vers le site. Conserver une telle recette conserve ses ingrédients et son lien, pas son texte.

### 5.2 Composition par Gemini

Le même appel demande en complément quelques recettes composées par le modèle, utiles quand le stock
est trop particulier pour que la recherche donne quelque chose — c'est précisément l'argument du
cahier pour la génération par IA.

Celles-ci portent **toutes** leurs étapes, affichables et conservables, et une mention visible
« proposée par l'IA ». Une proportion inventée est un risque assumé et annoncé, jamais masqué.

### 5.3 Enveloppe de réponse

Le modèle répond en JSON contraint par un schéma. Toute réponse qui ne valide pas le schéma Zod est
rejetée : aucune donnée du modèle n'entre dans l'application sans validation **[B9]**, au même titre
qu'une saisie utilisateur.

## 6. Variété imposée de la fournée

Puisque le filtrage ne relance pas de requête, la fournée doit être étalée dès le départ, sans quoi
un filtre légitime ne rendrait rien **[B10]**.

| Exigence | Valeur |
| --- | --- |
| Taille de la fournée | 12 recettes |
| Origines distinctes | au moins 4 |
| Recettes de 30 minutes ou moins | au moins 4 |
| Recettes très faciles ou faciles | au moins 3 |
| Recettes intermédiaires ou difficiles | au moins 2 |
| Issues du web | visées : 8 sur 12 |

Ces seuils sont demandés dans la requête **et vérifiés à la réception**. Une fournée qui ne les
respecte pas déclenche une seule requête complémentaire, ciblée sur la catégorie manquante ; si elle
échoue, la fournée est servie telle quelle et l'écran indique que le choix est restreint. **[B11]**

## 7. Rapprochement des ingrédients au stock

C'est le point dur : de ce rapprochement dépend tout l'affichage de ce qui manque.

Une fonction pure de `packages/shared` reçoit le libellé rendu par la recette et le catalogue des
produits, et rend un état :

| État | Règle | Affichage |
| --- | --- | --- |
| **Sûr** | le nom normalisé est identique à celui d'un produit | le produit, sans mention |
| **Probable** | similarité trigramme au-dessus du seuil | « sauce tomate → *Sauce tomate basilic* », marqué comme probable |
| **Absent** | aucun candidat au-dessus du seuil | traité comme manquant |

La normalisation réutilise `normalizeProductName`, et la similarité l'extension `pg_trgm` avec
`unaccent_lite()`, toutes deux en place depuis le lot 1.

Un rapprochement probable **ne bloque pas et ne demande rien** **[B12]** : il compte comme disponible
pour la couverture, il est signalé comme probable, et c'est au moment de cuisiner — dans le tiroir
qui existe déjà — que Franck confirme ou change le produit. Le seuil de similarité est fixé à
**0,40** et sera calibré sur le scénario figé **[B13]**.

Une fois les produits résolus, **la couverture est calculée par les règles existantes**, sans
réimplémentation : `recipeCoverage` et ses groupes s'appliquent tels quels.

## 8. Catégorisation

| Dimension | Valeurs | Origine |
| --- | --- | --- |
| Origine | les cuisines de la section 12 du cahier | rendue par le modèle, rapprochée de la table `Cuisine` par nom normalisé, créée si absente |
| Durée | ≤ 15, ≤ 30, ≤ 60 min, au-delà | temps total rendu, préparation et cuisson, **repos exclu** (A13) |
| Facilité | les quatre niveaux du cahier | **recalculée par `computeDifficulty`** à partir des étapes et du temps actif quand ils sont connus, sinon celle rendue par le modèle **[B14]** |

Le barème de difficulté du foyer prime sur l'avis du modèle : deux recettes affichées côte à côte
doivent être comparables.

## 9. Cache, fraîcheur et coût

Une fournée est enregistrée avec la signature de son point de départ **[B15]**. Elle est réutilisée
tant que la signature est inchangée, et au plus **24 heures**. Franck peut forcer une nouvelle
fournée en tirant l'écran vers le bas.

Les appels passent par le **même journal de coûts et le même plafond mensuel** que la reconnaissance
photo : `RecognitionLog` reçoit une colonne `purpose` (`VISION` ou `RECIPE_SUGGESTION`) **[B16]**, le
plafond `VISION_MONTHLY_CAP_CENTS` devient le plafond de l'ensemble des appels au modèle, et un quota
journalier propre aux suggestions (`RECIPE_SUGGESTION_DAILY_QUOTA`, défaut 20) évite l'emballement.

Plafond atteint : l'écran le dit en français, affiche la dernière fournée connue, et n'appelle plus.

## 10. Écrans

### Suggestions — écran d'entrée du module

Une liste de cartes. Chaque carte porte le titre, l'origine, la durée, la facilité, la pastille de
groupe et le taux de couverture, ce qui manque, une pastille anti-gaspillage quand la recette
consomme un produit proche de sa date, et la provenance : nom du site, ou « proposée par l'IA ».

Trois rangées de filtres, instantanées : origine, durée, facilité. Un compteur de filtres actifs et
un « Tout effacer », comme sur l'écran existant.

États à traiter, chacun avec son message français : fournisseur d'IA non configuré, première
ouverture sans stock exploitable, attente de la réponse du modèle, échec du modèle, plafond atteint,
fournée restreinte, aucun résultat après filtrage.

Sans fournisseur configuré (`VISION_PROVIDER=none`), l'écran ne tente aucun appel : il explique
qu'une clé est nécessaire et renvoie vers **Mes recettes**. Le module reste utilisable, il ne
suggère simplement rien.

### Fiche d'une suggestion

Ingrédients avec leur état et le détail des manquants ; étapes **si et seulement si** la recette est
composée par l'IA ; lien vers le site sinon. Deux actions : **conserver**, et **ouvrir le site**.

### Mes recettes

L'écran de liste du socle, inchangé, moins le bouton de création. Il garde ses filtres, ses cinq
tris et son tri par note par défaut.

### Fiche recette, tiroir de cuisson, formulaire

Inchangés. Le formulaire n'est plus atteignable qu'en modification.

## 11. Modèle de données

| Entité | Évolution |
| --- | --- |
| `SuggestionBatch` | **nouvelle** : signature du point de départ, date, charge utile JSON validée, coût, provenance du modèle |
| `RecognitionLog` | colonne `purpose` (`VISION` par défaut, `RECIPE_SUGGESTION`) |
| `Recipe` | inchangé : `source` (`GENERATED` ou `IMPORTED`) et `sourceUrl` existent déjà |
| `RecipeIngredient` | inchangé : une suggestion conservée crée ses lignes avec le produit rapproché, ou en texte libre |

Toute évolution passe par une migration Prisma versionnée et commitée.

## 12. Tests

- **Aucun appel réseau.** Les réponses de Gemini et les pages web sont rejouées depuis des fixtures,
  comme celles d'Open Food Facts et du fournisseur de vision **[B17]**.
- Fonctions pures de `packages/shared` : composition du point de départ, rapprochement au stock,
  contrôle de variété — testées isolément.
- Fixtures de pages réelles : une avec `schema.org/Recipe` complet, une sans, une qui n'est pas une
  recette, une qui dépasse le délai **[B18]**.
- Réponses du modèle : une conforme, une invalide au schéma, une sans assez d'origines distinctes.
- **Scénario figé** **[B19]** : stock défini, fixture de réponse définie, résultat attendu écrit
  d'avance. Il échoue si une règle de composition, de rapprochement ou de catégorisation change sans
  décision.
- Bout en bout : conserver une suggestion, puis la cuisiner, et vérifier que le stock a bougé.

## 13. Écart au cahier, à acter

La section 12 du cahier classe les sources de recettes dans cet ordre : saisie par le foyer
(priorité 1, « seule source indispensable au lot 2 »), import par URL (2), génération par IA (3,
`Should`). Cette spécification **inverse cet ordre** : la suggestion assistée devient l'entrée du
module, la saisie manuelle disparaît comme porte d'entrée, et l'import par URL devient un mécanisme
au service de la suggestion plutôt qu'une fonctionnalité distincte.

L'amendement à porter au cahier **[B20]** : réécrire « Origine des recettes » en section 12, faire
passer EF-26 en `Must`, reformuler EF-25 comme mécanisme interne, et consigner la date et le motif
au journal des amendements (section 26). Motif à consigner : à la livraison du socle, Franck a
constaté que l'approche ne répondait pas à son intention initiale, déjà exprimée lorsqu'il avait
demandé « tout, génération IA comprise ».

## 14. Ce que cette spécification ne tranche pas

- Le modèle Gemini exact et son tarif : à fixer à l'implémentation, en réutilisant la configuration
  du fournisseur de vision.
- La liste définitive des catégories non structurantes : une liste de départ sera proposée et
  ajustée à l'usage.
- Le seuil de similarité de 0,40 : à calibrer sur le scénario figé.
- La conduite à tenir si un site interdit la récupération automatique de ses pages : la première
  version se contente du délai et de l'échec silencieux.

## Annexe : arbitrages du 2026-10-04

| Réf | Arbitrage |
| --- | --- |
| B1 | Le stock est le point de départ de la suggestion ; la bibliothèque se remplit par choix |
| B2 | Plus de création manuelle ; le formulaire ne sert qu'à modifier une recette conservée |
| B3 | Le point de départ est composé par l'application et n'est pas montré à l'écran |
| B4 | Ce qui périme bientôt reste prioritaire dans la sélection |
| B5 | Exclusion des condiments par liste de catégories nommée dans `packages/shared` |
| B6 | Au plus huit ingrédients de départ |
| B7 | Les ingrédients d'une page web viennent de `schema.org/Recipe`, Gemini en repli |
| B8 | Les étapes d'une page tierce ne sont ni affichées ni stockées |
| B9 | Toute réponse du modèle est validée par un schéma Zod avant usage |
| B10 | Le filtrage porte sur la fournée reçue, sans nouvelle requête |
| B11 | La variété est exigée dans la requête et vérifiée à la réception |
| B12 | Un rapprochement probable ne bloque pas et ne demande rien ; il se confirme à la cuisson |
| B13 | Seuil de similarité fixé à 0,40, à calibrer |
| B14 | La difficulté est recalculée par le barème du foyer quand c'est possible |
| B15 | Une fournée est mise en cache par signature du point de départ, 24 heures au plus |
| B16 | Journal de coûts et plafond mensuel partagés, par une colonne `purpose` |
| B17 | Aucun test ne dépend du réseau |
| B18 | Fixtures de pages réelles, dont une sans données structurées et une en échec |
| B19 | Scénario de réussite figé, écrit d'avance |
| B20 | Le cahier est amendé avant le début des travaux |
