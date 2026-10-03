# Module recettes — socle

2026-10-03 · Franck, avec assistance de Claude · révision 2, arbitrages intégrés

Spécification du premier des trois incréments du module recettes : saisie par le foyer, taux de couverture avec le stock réel, filtres, écrans, cuisson avec décrément, historique et notation des réalisations, archivage. L'import par URL et la génération par IA font l'objet de spécifications distinctes, dans cet ordre.

Le document de référence reste `docs/cahier-des-charges.md`. Ce qui y est normatif n'est pas rediscuté ici : cette spécification ne traite que des choix laissés au jugement, et rend explicites les règles que le code devra appliquer. Un écart assumé au cahier est signalé en section 10.

Les décisions issues de la revue du 2026-10-03 sont repérées par leur numéro d'arbitrage, noté **[A1]** à **[A27]**, et récapitulées en annexe.

## 1. Intention

Répondre à « on mange quoi ce soir ? » à partir de ce qui est réellement dans les placards, en mettant en avant les recettes que le foyer apprécie. L'inventaire n'est pas une fin : c'est ce module qui lui donne sa valeur quotidienne.

Le succès du socle se mesure sur un scénario de recette figé **[A23]** : un stock défini, un jeu de recettes défini, et le résultat attendu écrit d'avance, recette par recette (couverture, groupe, manquants, ordre d'affichage). Le scénario couvre au minimum trois recettes réalisables, conformément à la recette du lot 2 (section 24 du cahier). Il vit dans la suite d'intégration et ne dépend pas de la semence de développement.

## 2. Périmètre

### Dans le socle

- Saisie et modification d'une recette par le foyer (source `HOUSEHOLD`).
- Calcul du taux de couverture et du groupe de chaque recette (section 12 du cahier).
- Filtres difficulté, cuisine, temps, type de plat, régime, mémorisés par utilisateur.
- Tri par défaut sur la note, tris alternatifs au choix.
- Écrans Recettes et Fiche recette (section 14 du cahier).
- Cuisson avec décrément ajusté aux portions, décochable ligne par ligne (EF-18).
- Historique des réalisations et notation par membre (EF-28, étendu) **[A24–A26]**.
- Archivage d'une recette déjà cuisinée **[A20]**.
- Jeu de données de développement : 8 recettes, quatre difficultés, cinq cuisines (section 19 du cahier), avec un historique de réalisations.

### Hors du socle, et pourquoi

- **EF-24, ajouter les ingrédients manquants aux courses.** La liste de courses n'existe pas encore : c'est un sous-projet distinct du lot 2. La fiche recette affiche les manquants, sans bouton d'ajout.
- **EF-25, import par URL, et EF-26, génération par IA** : incréments 2 et 3.
- **Photo de recette** : le champ `imagePath` existe ; l'envoi d'image sera repris du parcours produit dans un incrément ultérieur.
- **Annulation d'une cuisson** avec restitution du stock.
- **Statistiques globales du foyer** (recettes du mois, cuisines préférées) et suggestions fondées sur les goûts.
- **Comptage à la pièce** (« 3 œufs » face à « boîte de 6 ») **[A6]** : voir 4.2.

## 3. Modèle de données

Les entités `Recipe`, `RecipeIngredient`, `Cuisine` et `RecipeLog` existent déjà dans `prisma/schema.prisma`. Les ajouts ci-dessous sont couverts par une migration versionnée. Ceux marqués « si absent » sont à vérifier dans le schéma avant d'écrire la migration.

| Entité | Ajout | Raison |
|---|---|---|
| `UserPreference` | Nouvelle table `{ userId, key, value Json, updatedAt }`, unique (`userId`, `key`) | Filtres et tri « mémorisés par utilisateur » (section 12) ; la table `Setting` est globale à l'instance. Première clé : `recipeFilters`. |
| `RecipeIngredient` | `essential Boolean @default(false)` **[A1]** | Classement en groupes |
| `RecipeIngredient` | `substitutable Boolean @default(false)` **[A2]**, si absent | Ingrédient satisfait par toute la catégorie |
| `RecipeIngredient` | Index sur `categoryId` | La résolution des ingrédients visant une catégorie l'interroge |
| `Recipe` | `activeTime Int?`, en minutes **[A12]** | Calcul de la difficulté |
| `Recipe` | `dishType`, énumération à valeur unique **[A4]** | Filtre type de plat |
| `Recipe` | `diets`, tableau d'une énumération **[A5]** | Filtre régime |
| `Recipe` | `archivedAt DateTime?` **[A20]** | Archivage |
| `Cuisine` | `normalizedName`, unique **[A22]** | Pas de doublon |
| `RecipeLog` | `stockApplied Boolean` **[A26]** | Réalisation avec ou sans décrément |
| `RecipeRating` | Nouvelle table `{ id, recipeLogId, userId, stars 1-5, comment?, createdAt, updatedAt }`, unique (`recipeLogId`, `userId`) **[A24]** | Une note par membre et par réalisation |

**Type de plat** (valeur unique) : `STARTER`, `MAIN`, `DESSERT`, `SIDE`, `APERITIF`, `BREAKFAST`, `DRINK`.

**Régimes** (plusieurs possibles, liste extensible par migration) : `VEGETARIAN`, `VEGAN`, `GLUTEN_FREE`, `LACTOSE_FREE`, `PORK_FREE`.

**Note existante.** Si `RecipeLog` porte déjà une note (EF-28), la migration la reprend en un `RecipeRating` attribué à l'auteur de la réalisation, puis supprime la colonne.

**Étapes.** Le champ `steps` est un `Json` qui porte un tableau de chaînes, une par étape. Le schéma Zod partagé fixe cette forme ; aucune mise en forme riche au socle.

## 4. Règles pures, dans `packages/shared`

Conformément aux consignes du projet, aucune de ces règles ne vit dans un contrôleur ni dans un composant.

### 4.1 Difficulté calculée (décision 9 du cahier)

Le cahier impose un calcul automatique « d'après le nombre d'étapes, les techniques et le temps actif », puis une correction manuelle, sans que le recalcul écrase jamais une valeur corrigée. La formule n'étant pas spécifiée, elle est arrêtée ici, sous forme d'un score de 0 à 9.

| Critère | 0 point | 1 point | 2 points | 3 points |
|---|---|---|---|---|
| Nombre d'étapes | ≤ 3 | 4 à 6 | 7 à 10 | > 10 |
| Temps actif | ≤ 10 min | ≤ 25 min | ≤ 45 min | > 45 min |
| Techniques repérées | aucune | 1 | 2 | ≥ 3 |

Score total : 0-1 très facile, 2-3 facile, 4-6 intermédiaire, 7-9 difficile.

**Temps actif [A12].** C'est `activeTime` s'il est renseigné, sinon le temps de préparation.

**Techniques [A11].** Elles sont repérées par correspondance de **mots entiers** dans le texte des étapes, sur une table statique de `packages/shared`. La table liste explicitement chaque forme retenue (infinitif, impératif, participe : « réduire, réduisez, réduit, réduite »…). Il n'y a ni racinisation ni correspondance partielle. Techniques couvertes : émulsionner, monter en neige, caraméliser, flamber, pocher, réduire, clarifier, pétrir, lever, saisir, déglacer, tempérer, blanchir, confire. Le texte et la table sont normalisés en minuscules et sans accents, comme pour la recherche de produits. Une technique compte une fois par recette, quel que soit le nombre d'occurrences.

Pour limiter les faux positifs, la table comporte une courte liste d'expressions à ignorer, testées avant la correspondance : « réduire le feu », « baisser / réduire la flamme ».

**Correction manuelle.** `difficultyOverride` à vrai gèle la valeur : le recalcul la laisse intacte. Toute modification manuelle de la difficulté depuis l'interface pose ce drapeau.

### 4.2 Disponibilité d'un ingrédient (section 15 du cahier)

L'ordre d'évaluation est fixe : le premier cas qui s'applique l'emporte. Chaque ligne d'ingrédient est évaluée **indépendamment** **[A9]** : si un même produit apparaît sur deux lignes, les besoins ne sont pas additionnés. Un éventuel déficit est traité au moment de la cuisson par le plafonnement (section 5).

1. **Non rattaché**, sans produit ni catégorie : état `untracked`. L'ingrédient est affiché en gris et exclu du calcul. Cela vise le sel, l'eau, le poivre, que personne ne veut inventorier. L'utilisateur peut le rattacher à un produit s'il veut le suivre.
2. **Sans quantité chiffrée** : état `available` dès que la cible est en stock, quel que soit le volume. C'est la règle « une pincée de sel » de la section 15.
3. **Visant une catégorie, ou marqué substituable** : satisfait par n'importe quel produit de cette catégorie **ou de ses sous-catégories, récursivement** **[A3]**. Pour un ingrédient substituable qui vise un produit, la catégorie est celle de ce produit. Avec une quantité chiffrée, les stocks des produits retenus sont additionnés, mais seuls comptent ceux qui se convertissent dans la famille d'unités demandée, pont par la contenance compris. Un produit dont la quantité reste incomparable est ignoré dans la somme ; s'il est le seul en stock, l'ingrédient prend l'état `unverifiable` (cas 5).
4. **Visant un produit, avec quantité** : comparaison du stock disponible, converti dans la même famille d'unités, avec la quantité demandée.
5. **Comparaison impossible** : quand les familles diffèrent et que le produit n'a pas de contenance renseignée, ou pour toute quantité à la pièce **[A6]**. L'ingrédient prend l'état `unverifiable` : il compte comme disponible si le produit est en stock, et la fiche affiche « quantité non vérifiable ».

**Quantité insuffisante [A10].** Dans les cas 3 et 4, si la cible est en stock mais en quantité inférieure à la demande, l'ingrédient prend l'état `insufficient`. **Il compte comme disponible** pour la couverture et le groupe, et la fiche affiche une alerte « quantité insuffisante : 100 g sur 200 g ». Seule une cible absente du stock rend un ingrédient `missing`.

**Conversions.** Les familles d'unités de `packages/shared` s'appliquent, masse avec masse et volume avec volume. Quand les familles diffèrent, par exemple une recette en grammes face à un stock en paquets, le pont est `Product.netContent` et `netContentUnit` : un paquet de 500 g vaut 500 g. Il n'y a pas de famille « pièce » au socle **[A6]**.

**Stock pris en compte.** Lots non archivés, de quantité strictement positive, dont le statut de péremption n'est pas `expired_use_by`. Une DLC dépassée exclut l'article des recettes, une DDM dépassée ne l'exclut pas, et une date estimée n'exclut jamais : c'est exactement `excludedFromRecipes`, déjà écrite et testée au lot 1.

**États d'un ingrédient** : `available`, `insufficient`, `unverifiable`, `missing`, `untracked`. Les trois premiers comptent comme disponibles.

### 4.3 Couverture et groupe

Le **taux de couverture** est la part des ingrédients retenus (tous sauf `untracked`) qui comptent comme disponibles. Une recette sans aucun ingrédient retenu a une couverture de 100 % et appartient au groupe `ready` **[A7]**.

| Groupe | Règle |
|---|---|
| `ready` | Tous les ingrédients retenus sont disponibles |
| `almost` | Un ou deux manquants, aucun essentiel, **et** couverture ≥ 60 % **[A8]** |
| `excluded` | Tous les autres cas : plus de deux manquants, un ingrédient essentiel manquant, ou couverture < 60 % |

Le groupe est calculé et affiché sur chaque carte, mais **il ne détermine plus l'ordre de la liste ni la visibilité** **[A27]** : voir 4.5.

**Bonus anti-gaspillage (EF-27).** Le bonus est le nombre d'ingrédients distincts satisfaits par au moins un lot dont le statut est `soon` ou `expired_best_before`. Il n'entre jamais dans le taux : une recette ne devient pas « réalisable » parce qu'un produit périme. Il sert au tri « anti-gaspillage » (4.5) et à une pastille sur la carte.

### 4.4 Historique et appréciation

**Réalisation.** Chaque cuisson validée crée un `RecipeLog` avec `stockApplied` à vrai. Le bouton « J'ai fait cette recette » crée un `RecipeLog` avec `stockApplied` à faux et aucun mouvement de stock **[A26]**.

**Notation [A24, A25].** Chaque membre du foyer peut noter une réalisation de 1 à 5 étoiles, avec un commentaire facultatif, une seule fois par réalisation, et modifier sa note. La note peut être posée à la cuisson ou dans les **7 jours** qui suivent la date de la réalisation. Passé ce délai, elle est en lecture seule.

**Indicateurs par recette** :

| Indicateur | Règle |
|---|---|
| `timesCooked` | Nombre de `RecipeLog`, avec ou sans décrément |
| `lastCookedAt` | Date de la réalisation la plus récente |
| `averageRating` | Moyenne de toutes les notes de toutes les réalisations, arrondie au dixième ; `null` sans aucune note |
| `ratingCount` | Nombre de notes |
| `recentTrend` | Moyenne des 3 dernières réalisations notées comparée à la moyenne globale : `up`, `stable` ou `down` (écart ≥ 0,5) ; `null` sous 4 réalisations notées |

**Étiquettes dérivées**, calculées et jamais saisies :

- `trusted`, valeur sûre : moyenne ≥ 4 sur au moins 2 notes.
- `disliked`, à oublier : moyenne ≤ 2 sur au moins 2 notes.
- `never`, jamais faite : `timesCooked` = 0.
- `forgotten`, pas faite depuis longtemps : dernière réalisation il y a plus de 60 jours (seuil réglable dans `Setting`).

**Rappel de notation.** Une réalisation de moins de 7 jours sans note de l'utilisateur courant déclenche le rappel décrit en section 6.

### 4.5 Tri

**Tri par défaut, sur la note [A27].** Le stock n'intervient pas dans le classement par défaut. Toutes les recettes non archivées sont listées dans un seul ensemble, quel que soit leur groupe.

1. Recettes notées avant recettes jamais notées.
2. `averageRating` décroissante.
3. `ratingCount` décroissant (une moyenne sur plus d'avis passe devant).
4. Titre, dans l'ordre alphabétique normalisé.

**Tris au choix**, mémorisés avec les filtres :

| Clé | Ordre |
|---|---|
| `rating` (défaut) | Comme ci-dessus |
| `coverage` | Couverture décroissante, puis note, puis titre |
| `antiWaste` | Bonus décroissant, puis couverture, puis titre |
| `mostCooked` | `timesCooked` décroissant, puis titre |
| `leastRecent` | `lastCookedAt` croissant, jamais faites en premier, puis titre |

Tous les tris sont stables et testés comme tels.

## 5. API

Routes sous `/api/v1`, session obligatoire, enveloppe d'erreur habituelle. Tous les membres du foyer ont les mêmes droits sur les recettes, les cuisines et l'archivage **[A21]**. Un utilisateur ne peut poser ou modifier que sa propre note.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/recipes` | Liste, filtres et tri en paramètres |
| POST | `/recipes` | Création |
| GET | `/recipes/{id}` | Fiche, avec l'état de chaque ingrédient et les indicateurs |
| PATCH | `/recipes/{id}` | Modification |
| DELETE | `/recipes/{id}` | Suppression, refusée si la recette a au moins une réalisation |
| POST | `/recipes/{id}/archive` | Archivage |
| POST | `/recipes/{id}/restore` | Restauration |
| POST | `/recipes/{id}/cook` | Cuisson : mouvements, journal, note facultative |
| GET | `/recipes/{id}/logs` | Historique paginé des réalisations, avec leurs notes |
| POST | `/recipes/{id}/logs` | Réalisation sans décrément |
| PUT | `/recipe-logs/{id}/rating` | Note de l'utilisateur courant ; `409` hors de la fenêtre de 7 jours |
| DELETE | `/recipe-logs/{id}` | Suppression d'une réalisation, seulement si `stockApplied` est faux |
| GET | `/cuisines` | Liste, triée par nom |
| POST | `/cuisines` | Création ; `409` si le nom normalisé existe déjà **[A22]** |
| GET | `/preferences/recipe-filters` | Filtres et tri mémorisés de l'utilisateur |
| PUT | `/preferences/recipe-filters` | Enregistrement, validé par le schéma Zod partagé |

### Liste

`GET /recipes` accepte `difficulty`, `cuisine`, `maxTime`, `dishType`, `diet`, `tag`, `minRating`, `coverageMin`, `group`, `archived`, `sort`, `q`, plus la pagination habituelle.

- `maxTime` porte sur **préparation + cuisson**, sans le repos **[A13]**.
- `archived` vaut faux par défaut : les recettes archivées n'apparaissent que sur demande.
- Les filtres `difficulty`, `cuisine`, `maxTime`, `dishType`, `diet` et `archived` sont des prédicats SQL. Couverture, groupe, bonus, indicateurs et tri sont calculés ensuite, en mémoire.
- **Pagination en mémoire [A18].** Comme le tri dépend de valeurs calculées, toutes les recettes retenues par les prédicats SQL sont évaluées et triées, puis seulement découpées en pages. Paginer directement en base fausserait l'ordre : c'est interdit.

Chaque recette de la réponse porte `coverage`, `group`, `bonus`, `stats` (les indicateurs de 4.4, étiquettes comprises) et la liste des ingrédients manquants, pour que la liste n'ait pas à rappeler la fiche.

### Suppression et archivage [A20]

Une recette sans aucune réalisation se supprime réellement. Une recette déjà réalisée porte un historique : `DELETE` renvoie `409 conflict` avec le nombre de réalisations, et l'interface propose l'archivage. Une recette archivée disparaît des listes et des calculs, conserve son historique et ses notes, et peut être restaurée. Elle reste consultable depuis le filtre « archivées ».

### Cuisson

Le corps porte `servingsCooked`, une note facultative (étoiles et commentaire) et la liste des lignes retenues. Pour chaque ligne, le client envoie **la quantité de base de la recette**, éventuellement corrigée, et non une quantité déjà mise à l'échelle. Pour un ingrédient substituable ou visant une catégorie, il envoie aussi le produit choisi **[A15]**.

Le serveur, pour chaque ligne :

1. **Met la quantité à l'échelle** au prorata `servingsCooked / servings` **[A14]**. C'est le seul endroit où ce calcul a lieu.
2. **N'émet aucun mouvement** pour une ligne décochée, une ligne sans quantité chiffrée, ou une ligne `untracked` **[A17]**.
3. **Choisit les lots** du produit désigné par date effective la plus proche d'abord, de sorte que ce qui périme part en premier.
4. **Convertit et décrémente sans arrondi** : 200 g pris sur un paquet de 500 g retirent 0,4 paquet **[A16]**.
5. **Insère un mouvement** de type `RECIPE` rattaché au `RecipeLog` et recalcule la quantité du lot.
6. **Plafonne au stock disponible** (section 15 du cahier). La réponse indique les lignes plafonnées et la quantité réellement retirée.

L'opération est transactionnelle et porte un `clientOpId`, comme toute écriture de stock. Le `RecipeLog` est créé avec `stockApplied` à vrai, et le `RecipeRating` de l'utilisateur courant l'est aussi si une note est fournie.

## 6. Écrans

### Recettes

C'est l'onglet existant, qui remplace le bandeau « Disponible au lot 2 ».

- **Barre de filtres** persistante en tête, repliée en une ligne de pastilles au défilement. Elle porte les filtres, le choix du tri, et les pastilles rapides « Valeurs sûres », « Jamais faites », « Pas faites depuis longtemps », « Réalisables maintenant ».
- **Liste unique**, triée par note par défaut **[A27]**. Chaque carte porte :
  - le titre, la cuisine, le temps (préparation et cuisson), la difficulté ;
  - **le taux de couverture et le groupe, bien visibles** (pastille colorée « prête », « presque », « incomplète »), puisque le stock ne règle plus l'ordre ;
  - le cas échéant, « il manque la crème » ou « il manque 2 ingrédients » ;
  - la ligne d'historique « Faite 7 fois · il y a 12 jours · ★ 4,3 », ou « Jamais faite » ;
  - la pastille anti-gaspillage quand le bonus est positif.
- **Rappel de notation** : une ligne discrète en tête, « Notez le gratin d'hier », tant qu'une réalisation de moins de 7 jours n'a pas de note de l'utilisateur. Elle se ferme d'un geste et réapparaît au plus une fois par jour.
- **État vide** : il explique l'action suivante, la création d'une première recette, et jamais un simple « aucun résultat ».

### Fiche recette

- **Ingrédients avec leur état** : disponible, quantité insuffisante (« 100 g sur 200 g »), quantité non vérifiable, manquant, hors inventaire. Les ingrédients essentiels portent une marque.
- **Étapes numérotées**, puis la difficulté avec sa pastille de correction, les temps (préparation, actif, cuisson, repos) et les portions.
- **Bloc « Historique »** : la moyenne, le nombre de réalisations, la tendance, puis la liste des réalisations (date, portions, qui a cuisiné, avec ou sans décrément, note et commentaire de chaque membre). La note de l'utilisateur est modifiable pendant 7 jours.
- **Actions** : cuisiner, « J'ai fait cette recette », modifier, supprimer ou archiver selon l'historique, restaurer si la recette est archivée.

### Cuisson

C'est un tiroir ancré en bas, dans l'esprit du tiroir de validation du scan.

- **Portions réalisées**, par défaut égales aux portions de la recette.
- **Lignes décochables**, chacune avec sa quantité recalculée en direct.
- **Choix du produit** pour un ingrédient substituable ou visant une catégorie **[A15]** : un sélecteur liste les produits en stock et présélectionne celui dont le lot périme le plus tôt.
- **Note facultative** de 1 à 5 étoiles, avec la mention « vous pourrez noter après le repas, pendant 7 jours ».

Le décrément n'a lieu qu'à la validation.

### Formulaire de recette

C'est un écran plutôt qu'un tiroir, la saisie étant longue. Les ingrédients se rattachent par la recherche de produits existante, qui tolère déjà les fautes et les synonymes, ou se laissent en texte libre. Chaque ligne porte les cases « essentiel » et « substituable », décochées par défaut **[A1, A2]**. Le formulaire comporte aussi le type de plat (une valeur), les régimes (plusieurs) et le temps actif facultatif. La difficulté est proposée en direct par le calcul, et l'utilisateur peut la corriger, ce qui pose le drapeau.

## 7. Performance

La cible de la section 13 du cahier est de deux secondes pour 300 recettes et 1 500 articles.

**Instantané de stock [A19].** Les lots retenus sont chargés **un par un** en une requête (environ 1 500 lignes), et `excludedFromRecipes` ainsi que le statut de péremption leur sont appliqués en TypeScript. L'instantané est ensuite indexé en mémoire par produit et par catégorie, sous-catégories comprises. La couverture se calcule par recherche dans ces tables de hachage, soit environ 3 000 vérifications. Les indicateurs d'historique viennent d'une requête agrégée groupée par recette.

Un test de charge, inscrit dans la suite d'intégration, sème ces volumes et vérifie le temps de réponse.

## 8. Tests

**Unitaires**, sur les fonctions pures :

- chaque ligne du tableau de difficulté, le repli du temps actif sur la préparation, la correspondance par mots entiers et les expressions ignorées ;
- chaque cas de disponibilité de 4.2, dont les sous-catégories récursives, le pont par la contenance, l'état `insufficient` compté comme disponible, l'état `unverifiable`, l'exclusion des DLC dépassées, et l'indépendance des lignes portant le même produit ;
- les trois groupes à leurs seuils exacts (60 %, deux manquants, ingrédient essentiel), la recette sans ingrédient retenu ;
- le bonus ;
- les indicateurs : moyenne avec et sans notes, tendance, chaque étiquette à ses seuils, fenêtre de 7 jours au jour près ;
- chaque tri, et sa stabilité.

**Intégration**, sur chaque route, codes d'erreur compris :

- suppression refusée après une réalisation, archivage puis restauration, recette archivée absente de la liste par défaut ;
- filtres combinés, `maxTime` sans le repos, pagination correcte quand le tri dépend de la couverture ;
- mémorisation des filtres et du tri par utilisateur ;
- cuisson partielle avec lignes décochées, mise à l'échelle faite une seule fois, choix du produit pour une ligne substituable, décrément fractionné, absence de mouvement pour les lignes sans quantité, plafonnement ;
- notation par deux membres de la même réalisation, refus après 7 jours, réalisation sans décrément sans aucun mouvement, suppression refusée d'une réalisation avec décrément ;
- cuisine en doublon refusée (« Créole » face à « creole ») ;
- **scénario de réussite figé [A23]** : stock et recettes définis, résultat attendu vérifié recette par recette.

**Semence de développement** : les 8 recettes de la section 19 du cahier, avec un historique de réalisations et de notes sur 4 d'entre elles, dates relatives au jour d'exécution comme le reste du jeu.

Aucun test ne dépend du réseau, conformément aux consignes.

## 9. Ce que cette spécification ne tranche pas

- La photo de recette, dont le champ existe déjà en base.
- Le format d'échange des recettes, qui sera déterminé par l'incrément d'import.
- Le comptage à la pièce, à reprendre si l'état « quantité non vérifiable » s'avère trop fréquent à l'usage.
- L'annulation d'une cuisson.

## 10. Écart au cahier à valider

**EF-27 et section 12 : priorité au stock et aux produits proches de leur date.** Le cahier demande de prioriser les recettes réalisables et celles qui consomment des articles proches de leur date. Le tri par défaut retenu ici est la note **[A27]**. Le stock et l'anti-gaspillage restent accessibles par les tris `coverage` et `antiWaste`, par la pastille « Réalisables maintenant » et par l'affichage du groupe sur chaque carte. Il ne s'agit plus du comportement par défaut. Si le cahier est normatif sur ce point, il faut l'amender en même temps que cette spécification.

---

## Annexe : arbitrages du 2026-10-03

| # | Sujet | Décision |
|---|---|---|
| A1 | Ingrédient essentiel | Case sur l'ingrédient, décochée par défaut |
| A2 | Ingrédient substituable | Case sur l'ingrédient, décochée par défaut |
| A3 | Catégories | Une catégorie inclut ses sous-catégories, récursivement |
| A4 | Type de plat | Énumération fermée, une valeur par recette |
| A5 | Régime | Étiquettes multiples, liste extensible |
| A6 | Unités à la pièce | Pas de comptage ; produit en stock = disponible, « quantité non vérifiable » |
| A7 | Recette sans ingrédient suivi | Couverture 100 %, groupe `ready` |
| A8 | Groupe « presque » | ≤ 2 manquants, aucun essentiel, et couverture ≥ 60 % |
| A9 | Même produit sur plusieurs lignes | Lignes évaluées séparément ; le plafonnement à la cuisson gère le déficit |
| A10 | Quantité insuffisante | Compte comme disponible, avec alerte sur la fiche |
| A11 | Repérage des techniques | Mots entiers, table explicite des formes, sans racinisation |
| A12 | Temps actif | Champ facultatif, repli sur la préparation |
| A13 | Filtre de temps | Préparation + cuisson, sans le repos |
| A14 | Mise à l'échelle des portions | Faite par le serveur uniquement |
| A15 | Décrément d'un substituable | Le tiroir demande le produit et présélectionne celui qui périme le plus tôt |
| A16 | Décrément en paquets | Fraction conservée, sans arrondi |
| A17 | Lignes sans quantité ou non suivies | Aucun mouvement de stock |
| A18 | Pagination | En mémoire, après le tri ; écrit dans la spec |
| A19 | Lecture du stock | Lots chargés un par un, règle d'exclusion du lot 1 en TypeScript |
| A20 | Recette déjà cuisinée | Archivage dès le socle, avec restauration |
| A21 | Droits dans le foyer | Tous les membres ont tous les droits |
| A22 | Doublons de cuisines | Unicité sur le nom sans majuscules ni accents |
| A23 | Critère de réussite | Scénario figé, résultat attendu écrit d'avance |
| A24 | Notation | Une note par membre et par réalisation, de 1 à 5 étoiles ; moyenne pour la recette |
| A25 | Moment de la notation | À la cuisson ou dans les 7 jours, avec rappel |
| A26 | Réalisation sans décrément | Bouton « J'ai fait cette recette » |
| A27 | Tri par défaut | Par note, sans le stock ; une seule liste, groupe affiché sur la carte |
