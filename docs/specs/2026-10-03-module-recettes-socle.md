# Module recettes — socle

2026-10-03 · Franck, avec assistance de Claude

Spécification du premier des trois incréments du module recettes : saisie par
le foyer, taux de couverture avec le stock réel, filtres, écrans, cuisson avec
décrément. L'import par URL et la génération par IA font l'objet de
spécifications distinctes, dans cet ordre.

Le document de référence reste `docs/cahier-des-charges.md`. Ce qui y est
normatif n'est pas rediscuté ici : cette spécification ne traite que des choix
laissés au jugement, et rend explicites les règles que le code devra appliquer.

## 1. Intention

Répondre à « on mange quoi ce soir ? » à partir de ce qui est réellement dans
les placards. L'inventaire n'est pas une fin : c'est ce module qui lui donne sa
valeur quotidienne.

Le succès du socle se mesure à la recette du lot 2 (section 24) : au moins
trois recettes réalisables proposées à partir du stock courant, filtres actifs.

## 2. Périmètre

**Dans le socle**

- Saisie et modification d'une recette par le foyer (source `HOUSEHOLD`).
- Calcul du taux de couverture et classement en trois groupes (section 12).
- Filtres difficulté, cuisine, temps, type de plat, régime, mémorisés par
  utilisateur.
- Écrans Recettes et Fiche recette (section 14).
- Cuisson avec décrément ajusté aux portions, décochable ligne par ligne
  (EF-18), et notation à la cuisson (EF-28).
- Jeu de données de développement : 8 recettes, quatre difficultés, cinq
  cuisines (section 19).

**Hors du socle, et pourquoi**

- **EF-24, ajouter les ingrédients manquants aux courses.** La liste de
  courses n'existe pas encore : elle est un sous-projet distinct du lot 2, non
  encore réalisé. La fiche recette affichera les manquants, sans bouton
  d'ajout. Ce bouton arrivera avec la liste de courses.
- **EF-25, import par URL** et **EF-26, génération par IA** : incréments 2 et 3.
- Photo de recette : le champ `imagePath` existe, l'envoi d'image sera repris
  du parcours produit lors d'un incrément ultérieur.

## 3. Modèle de données

Les entités `Recipe`, `RecipeIngredient`, `Cuisine` et `RecipeLog` existent
déjà dans `prisma/schema.prisma` et suffisent. Deux ajouts, couverts par une
migration versionnée :

- `UserPreference { userId, key, value Json, updatedAt }`, clé unique
  `(userId, key)`. La section 12 exige que le réglage des filtres soit
  « mémorisé par utilisateur », ce que la table `Setting`, globale à
  l'instance, ne permet pas. Première clé : `recipeFilters`.
- Index `RecipeIngredient.categoryId`, absent aujourd'hui alors que la
  résolution des ingrédients visant une catégorie l'interroge.

Le champ `steps` est un `Json` : il portera un tableau de chaînes, une par
étape. Le schéma Zod partagé fixe cette forme ; aucune mise en forme riche au
socle.

## 4. Règles pures, dans `packages/shared`

Conformément aux consignes du projet, aucune de ces règles ne vit dans un
contrôleur ni dans un composant.

### 4.1 Difficulté calculée (décision 9)

Le cahier impose le calcul automatique « d'après le nombre d'étapes, les
techniques et le temps actif », puis la correction manuelle, sans que le
recalcul écrase jamais une valeur corrigée. La formule n'étant pas spécifiée,
elle est arrêtée ici, sous forme d'un score de 0 à 9.

| Critère | 0 point | 1 point | 2 points | 3 points |
| --- | --- | --- | --- | --- |
| Nombre d'étapes | ≤ 3 | 4 à 6 | 7 à 10 | > 10 |
| Temps actif (préparation) | ≤ 10 min | ≤ 25 min | ≤ 45 min | > 45 min |
| Techniques repérées | aucune | 1 | 2 | ≥ 3 |

Score total : 0-1 très facile, 2-3 facile, 4-6 intermédiaire, 7-9 difficile.

Les techniques sont repérées par correspondance de mots-clés dans le texte des
étapes, sur une table statique de `packages/shared` : émulsionner, monter en
neige, caraméliser, flamber, pocher, réduire, clarifier, pétrir, lever, saisir,
déglacer, tempérer, blanchir, confire, et leurs variantes. La table est
normalisée sans accent, comme la recherche de produits.

`difficultyOverride` à vrai gèle la valeur : le recalcul la laisse intacte.
Toute modification manuelle de la difficulté depuis l'interface pose ce drapeau.

### 4.2 Disponibilité d'un ingrédient (section 15)

L'ordre d'évaluation est fixe, le premier cas qui s'applique l'emporte.

1. **Ingrédient non rattaché**, sans produit ni catégorie : il est marqué
   *hors inventaire*, affiché en gris et exclu du calcul. Cela vise le sel,
   l'eau, le poivre, que personne ne veut inventorier. L'utilisateur peut le
   rattacher à un produit s'il souhaite le suivre.
2. **Sans quantité chiffrée** : disponible dès que la cible est en stock, quel
   que soit le volume. C'est la règle « une pincée de sel » de la section 15.
3. **Visant une catégorie**, ou **marqué substituable** : satisfait par
   n'importe quel produit de cette catégorie. Avec une quantité chiffrée, les
   stocks des produits de la catégorie sont additionnés, mais seuls comptent
   ceux qui se convertissent dans la famille d'unités demandée, le pont par la
   contenance compris. Un produit dont la quantité reste incomparable est
   ignoré dans la somme plutôt que compté pour zéro ou pour tout, et la fiche
   le signale comme pour le cas précédent.
4. **Visant un produit, avec quantité** : disponible si le stock disponible,
   converti dans la même famille d'unités, atteint la quantité demandée.

Conversions : les familles de `packages/shared` s'appliquent, masse avec masse,
volume avec volume. Quand les familles diffèrent, par exemple une recette en
grammes face à un stock en paquets, le pont est `Product.netContent` et
`netContentUnit`, prévus pour cela : un paquet de 500 g vaut 500 g. Sans
contenance renseignée, la comparaison est impossible : l'ingrédient est alors
considéré disponible si le produit est en stock, et signalé comme
*quantité non vérifiable* dans la fiche, pour que l'utilisateur sache pourquoi.

**Stock pris en compte** : lots non archivés, quantité strictement positive,
dont le statut de péremption n'est pas `expired_use_by`. Une DLC dépassée
exclut l'article des recettes, une DDM dépassée ne l'exclut pas, et une date
estimée n'exclut jamais : c'est exactement `excludedFromRecipes`, déjà écrite
et testée au lot 1.

### 4.3 Couverture et classement

Le taux de couverture est la part des ingrédients retenus, c'est-à-dire hors
*hors inventaire*, qui sont disponibles. Les trois groupes de la section 12 :

| Groupe | Règle |
| --- | --- |
| `ready` | Tous les ingrédients retenus sont disponibles |
| `almost` | Un ou deux manquants, aucun n'étant essentiel |
| `excluded` | Au-delà de deux manquants, ou un ingrédient essentiel absent |

Le groupe `excluded` est masqué par défaut et affichable à la demande.

**Bonus anti-gaspillage (EF-27).** Le cahier demande de prioriser les recettes
qui consomment des articles proches de leur date. Le bonus est le nombre
d'ingrédients distincts satisfaits par au moins un lot dont le statut est
`soon` ou `expired_best_before`. Il intervient au tri, jamais dans le taux :
une recette ne devient pas « réalisable » parce qu'un produit périme.

**Tri** : groupe, puis bonus décroissant, puis couverture décroissante, puis
titre. Le tri est stable et testé comme tel.

## 5. API

Routes sous `/api/v1`, session obligatoire, enveloppe d'erreur habituelle.

| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/recipes` | Liste triée par couverture, filtres en paramètres |
| POST | `/recipes` | Création |
| GET | `/recipes/{id}` | Fiche, avec l'état de chaque ingrédient |
| PATCH | `/recipes/{id}` | Modification |
| DELETE | `/recipes/{id}` | Suppression, refusée si la recette a été cuisinée |
| POST | `/recipes/{id}/cook` | Cuisson : mouvements et journal |
| GET | `/cuisines` | Liste, triée par nom |
| POST | `/cuisines` | Création, la liste étant extensible (section 12) |
| GET | `/preferences/recipe-filters` | Filtres mémorisés de l'utilisateur |
| PUT | `/preferences/recipe-filters` | Enregistrement des filtres |

`GET /recipes` accepte `difficulty`, `cuisine`, `maxTime`, `dishType`, `diet`,
`coverageMin`, `includeExcluded`, `q`, plus la pagination habituelle. Les cinq
premiers filtres sont des prédicats SQL ; la couverture est calculée ensuite.
La réponse enveloppe chaque recette avec `coverage`, `group`, `bonus`, et la
liste des ingrédients manquants, pour que la liste n'ait pas à rappeler la
fiche.

**Suppression.** Une recette déjà cuisinée porte un historique de mouvements :
la supprimer casserait la traçabilité. `DELETE` renvoie alors `409 conflict`
avec le nombre de cuissons, et l'interface propose l'archivage, qui est une
suppression logique à prévoir au moment où ce cas se présentera. Au socle, le
refus suffit.

**Cuisson.** Le corps porte `servingsCooked`, une note facultative, et la liste
des lignes retenues avec leur quantité. Le serveur, pour chaque ligne :
calcule la quantité réelle au prorata des portions, choisit les lots du produit
par date effective la plus proche d'abord, de sorte que ce qui périme part en
premier, insère un mouvement de type `RECIPE` rattaché au `RecipeLog` et
recalcule la quantité du lot. Une ligne décochée ne produit aucun mouvement.
L'opération est transactionnelle et porte un `clientOpId`, comme toute écriture
de stock. Le plafonnement au stock disponible de la section 15 s'applique
ligne par ligne, et le résultat indique ce qui a été plafonné.

## 6. Écrans

**Recettes**, onglet existant qui remplace le bandeau « Disponible au lot 2 ».
Barre de filtres persistante en tête, repliée en une ligne de pastilles quand
on défile. Liste ordonnée, chaque carte portant le titre, la cuisine, le temps
total, la difficulté, le taux de couverture et, le cas échéant, « il manque la
crème » ou « il manque 2 ingrédients ». Les recettes écartées sont derrière un
bouton « voir aussi les recettes incomplètes ». L'état vide explique l'action
suivante, création d'une première recette, jamais un simple « aucun résultat ».

**Fiche recette.** Ingrédients avec leur état, disponible, manquant, hors
inventaire ou quantité non vérifiable, puis les étapes numérotées, la
difficulté avec sa pastille de correction, les temps et les portions. Actions :
cuisiner, modifier, supprimer.

**Cuisson.** Tiroir ancré en bas, dans l'esprit du tiroir de validation du
scan : nombre de portions réalisées par défaut égal aux portions de la recette,
chaque ligne décochable avec sa quantité recalculée en direct, puis une note
facultative de une à cinq étoiles. Le décrément n'a lieu qu'à la validation.

**Formulaire de recette.** Un écran plutôt qu'un tiroir, la saisie étant
longue. Les ingrédients se rattachent par la recherche de produits existante,
qui tolère déjà les fautes et les synonymes, ou se laissent en texte libre.
La difficulté est proposée en direct par le calcul, et l'utilisateur peut la
corriger, ce qui pose le drapeau.

## 7. Performance

La cible de la section 13 est de deux secondes pour 300 recettes et 1 500
articles. L'instantané de stock est construit par deux requêtes agrégées, une
par produit et une par catégorie, puis la couverture est calculée en mémoire :
3 000 vérifications dans une table de hachage. Un test de charge, inscrit dans
la suite d'intégration, sème ces volumes et vérifie le temps de réponse.

## 8. Tests

- **Unitaires** sur les fonctions pures : chaque ligne du tableau de difficulté,
  chaque cas de disponibilité de la section 4.2, y compris le pont par la
  contenance et l'exclusion des DLC dépassées, les trois groupes, le bonus et
  la stabilité du tri.
- **Intégration** sur chaque route, dont les codes d'erreur : suppression
  refusée après cuisson, filtres combinés, mémorisation par utilisateur,
  cuisson partielle avec lignes décochées, plafonnement au stock disponible.
- **Semence** de développement enrichie des 8 recettes de la section 19, dates
  relatives au jour d'exécution comme le reste du jeu.
- Aucun test ne dépend du réseau, conformément aux consignes.

## 9. Ce que cette spécification ne tranche pas

- L'archivage logique d'une recette cuisinée, repoussé jusqu'à ce que le besoin
  se présente réellement.
- La photo de recette, dont le champ existe déjà en base.
- Le format d'échange des recettes, qui sera déterminé par l'incrément
  d'import.
