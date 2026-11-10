# « Mes recettes » : étoilée ou réalisée

**Date** : 2026-11-09
**Deux demandes du propriétaire, le même jour, qui se complètent** :

1. « Toutes les recettes remontées sont enregistrées dans la base de données
   des recettes » — *alimenter la base*.
2. « Dans mes recettes, ne mettre que les recettes que j'ai indiqué avec une
   étoile (favori) ou une recette que j'ai réalisée, laisser les autres dans
   suggestion » — *ce que l'écran montre*.

Elles ne s'opposent pas : la première dit ce qu'on **stocke**, la seconde ce
qu'on **affiche**. Une première version de ce document a pris la seconde pour
une annulation de la première et supprimé l'enregistrement ; c'était une
erreur de lecture, corrigée ici.

## D'où vient la demande

Le geste « Je fais cette recette » était le seul chemin entre une suggestion et
la bibliothèque. Il mélangeait deux intentions : *je veux garder celle-ci* et
*je la cuisine maintenant*. À l'usage, le propriétaire a conservé vingt-deux
recettes pour essayer l'application, sans jamais se servir de l'étoile — elle
n'avait rien à marquer de plus — et sa bibliothèque ne distinguait plus ce
qu'il avait choisi de ce qu'il avait seulement regardé.

Sa règle sépare les deux : la bibliothèque n'est plus ce qu'on a *conservé*,
mais ce qu'on a **étoilé ou fait**. Tout le reste reste une suggestion.

L'état de départ a été remis à zéro le 2026-11-09 : bibliothèque vide, onze
recettes supprimées (déjà présentes au réservoir, donc de retour dans
Suggestions) et onze archivées — dont celle qui portait la seule réalisation
ayant décrémenté le stock.

## Intention

Qu'une suggestion puisse être étoilée ou cuisinée **là où elle s'affiche**, et
que ce geste — lui seul — la fasse entrer dans « Mes recettes ».

## Buts

- **Toute suggestion qui entre au réservoir devient aussi une `Recipe`**, avec
  ses ingrédients rapprochés du catalogue, ses étapes, ses durées : une vraie
  recette interrogeable, pas un payload JSON.
- Les 349 lignes déjà au réservoir sont rattrapées une fois.
- Une étoile sur la suggestion, depuis sa carte et depuis son tiroir.
- « Mes recettes » ne **liste** que les recettes étoilées ou réalisées.
- Suggestions cesse de proposer ce qui est étoilé ou réalisé, et continue de
  proposer le reste.

## Non-buts

- Aucune nouvelle colonne : `Recipe.favorite` et `RecipeLog` sont les deux
  marqueurs, ils existent déjà.
- Aucun nouveau geste nommé « Adopter » : l'étoile et la réalisation sont
  l'adoption.
- Les recettes archivées du 2026-11-09 restent archivées ; rien ne les rouvre.

## Anti-buts — ce qui ferait de cette évolution un échec

- **Un réservoir qui se vide.** `SuggestionsService.readPool` écarte aujourd'hui
  toute entrée dont le titre correspond à une `Recipe` de source `IMPORTED` ou
  `GENERATED`. Si la création d'une recette suffisait à écarter la suggestion,
  étoiler deviendrait le seul moyen de faire disparaître une proposition — et
  toute recette créée pour une autre raison la retirerait du réservoir sans
  qu'on l'ait voulu.
- **Un doublon par geste.** Étoiler puis cuisiner la même suggestion ne doit
  pas créer deux recettes.
- **Une étoile qui ment.** Étoiler depuis la carte doit se voir immédiatement,
  et survivre au rechargement — sans quoi on étoile deux fois.

## Contraintes

- `StockItem.quantity` reste la somme des `StockMovement` : cuisiner depuis une
  suggestion passe par le chemin de cuisson existant, jamais par une écriture
  directe.
- Les règles métier sont des fonctions pures dans `packages/shared`.
- Anglais pour le code, français pour les libellés.
- Aucun test ne dépend du réseau.
- Une recette réalisée ne se supprime pas : `RecipeLog` l'en empêche par clé
  étrangère (constaté le 2026-11-09). Toute opération de nettoyage archive.

## Les décisions prises

| | Décision | Pourquoi |
| --- | --- | --- |
| **D1** | Toute suggestion ingérée au réservoir est aussi créée en `Recipe` (`source = GENERATED`), par le chemin existant de `keep` — aucun appel au modèle pour une composition. L'écriture se fait **après** la réponse rendue à l'écran. | C'est la première demande. Faite dans la requête, elle ajouterait une centaine de rapprochements `pg_trgm` à un écran dont la latence vient d'être durement gagnée. |
| **D2** | `readPool` n'écarte plus sur la source mais sur le marqueur : une entrée du réservoir disparaît des suggestions si sa recette est **étoilée ou réalisée**. | Répond à l'anti-but du réservoir qui se vide, et dit en une phrase la règle du propriétaire. |
| **D3** | `keep` devient idempotent par identité de suggestion : si la recette existe déjà, elle est rendue telle quelle. L'appariement reprend celui de `readPool` — titre normalisé, `suggestionIdentity` — sans nouvelle colonne. | Deux gestes sur la même suggestion ne doivent pas faire deux recettes. Le titre suffit : le réservoir dédoublonne déjà sur cette identité. |
| **D4** | « Mes recettes » filtre **en base** sur `favorite = true OR logs non vide`, avant tout calcul de couverture. | La bibliothèque reste petite, donc le rapprochement `pg_trgm` ne porte que sur elle : la question de performance de la version précédente disparaît. |
| **D5** | Le bouton « Je fais cette recette » garde son libellé et son effet — il enregistre une réalisation — mais la fiche s'atteint désormais **sans lui** : la carte d'une suggestion mène à la recette. | Il mélangeait « garder » et « faire ». Débarrassé du premier rôle, il ne dit plus que ce qu'il fait. |
| **D6** | Les 349 lignes du réservoir sont rattrapées une fois. `SuggestionsService.catalogueAll()` fait le travail et est testé ; **le déclencheur reste à écrire**. | Sans lui, la base ne contiendrait que ce qui arrive à partir de maintenant, et le propriétaire veut garder ce qui existe. |
| **D7** | Une suggestion dont la création de recette échoue ne fait pas échouer la demande : l'erreur est journalisée, le rattrapage la reprendra. | L'écran doit rendre ses recettes ; une base en retard d'une ligne n'est pas un échec visible. |

## Le déclencheur du rattrapage (livré le 2026-11-10)

Un outil de `tools/`, comme `nutriscore-rattrapage`, a été écrit puis **retiré**
le 2026-11-09. Deux obstacles, constatés et non supposés :

- `tools/tsconfig.json` n'active pas les décorateurs. Un outil qui importe
  `AppModule` pour résoudre le service ne compile pas : chaque `@Get`, `@Post`
  et `@Injectable` de l'API sort en erreur `TS1241`.
- Même en les activant, la compilation des outils ferait entrer tout l'API dans
  `tools/dist`, que le `Dockerfile` recopie à la racine de l'image — soit un
  second exemplaire du serveur à côté du vrai.

`nutriscore-rattrapage` n'a pas ce problème parce qu'il enveloppe une
**fonction** (`rattraper`), pas un service : il reçoit un client Prisma et rien
d'autre. La création d'une recette depuis une suggestion, elle, traverse trois
services injectés.

La forme qui reste est donc celle que le projet emploie déjà pour l'autre
rattrapage : **une route d'administration**, `GET`/`POST
/suggestions/catalogue`, avec un avancement en mémoire et un bouton dans
Réglages — exactement `products/nutrition/backfill`. Elle s'exécute dans le
conteneur de l'application, avec son conteneur d'injection, et donne un bouton
plutôt qu'une commande SSH.

**C'est cette forme qui a été livrée le 2026-11-10** : `GET /suggestions/catalogue`
rend l'avancement (lisible par tous), `POST` le lance (administrateur, 202),
l'état vit en mémoire dans `SuggestionsService` — un passage interrompu par un
redémarrage n'a rien à reprendre, puisqu'une relance ne considère que les
suggestions encore sans recette —, et la ligne « Recettes du réservoir » de
Réglages › Reconnaissance porte le bouton.

## Amendement du 2026-11-10 : le retrait de l'étoile s'annonce

Retirer l'étoile d'une recette venue d'une suggestion et jamais réalisée la
fait sortir de « Mes recettes » — une disparition, au même titre qu'un
effacement, et jusqu'ici silencieuse. Elle demande désormais confirmation, avec
la même forme que « Effacer cette recette ? », à la liste comme à la fiche.

La condition n'est pas recopiée : `inLibrary` et `unfavoriteLeavesLibrary`
(`packages/shared/src/rules/recipe-library.ts`) énoncent la règle D1 et sont
éprouvées ; la clause Prisma du filtre de bibliothèque s'y réfère, et l'écran
les appelle. Pour cela, `source` passe du `RecipeDto` au `RecipeSummaryDto` :
sans elle, l'écran ne peut pas distinguer une recette saisie au foyer — qui ne
sort jamais, et qu'il ne faut donc pas annoncer — d'une suggestion gardée.

## Ce qui reste au jugement du constructeur

- La place de l'étoile sur la carte de suggestion, et la façon dont elle se
  distingue de l'étoile déjà présente sur les cartes de « Mes recettes ».
- Le retour visuel entre le clic et la création effective de la recette.
- Si la fiche d'une suggestion non encore étoilée affiche, ou non, une mention
  disant qu'elle n'est pas dans la bibliothèque.
- L'ordre et les filtres de « Mes recettes », qui ne changent pas.

## Ce que ça pèse

Quatre morceaux : la création automatique après chaque fournée, le rattrapage
des 349, l'étoile sur la suggestion, et les deux critères — celui qui exclut du
réservoir, celui qui remplit la bibliothèque. **Aucune migration** : les deux
marqueurs existent déjà, et l'appariement se fait sur l'identité de suggestion
que le réservoir emploie.

Le point à surveiller est le volume. `Recipe` passera de 0 à 349 au rattrapage,
puis grossira de trois à quatre par recherche. La bibliothèque, elle, reste
petite puisqu'elle filtre en base — mais tout écran ou export qui parcourrait
`Recipe` sans filtre paiera ce volume.
