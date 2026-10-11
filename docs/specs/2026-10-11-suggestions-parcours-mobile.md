# Suggestions : parcours dirigé et filtres compacts sur mobile

**Statut :** décisions prises par djkix le 2026-10-11, à exécuter.
**Demande :** « il faut revoir l'approche pour les recettes, ce n'est pas intuitif
et fastidieux à l'utilisation. »

## 1. Le problème constaté

Trois défauts, tous visibles au téléphone — qui est l'usage de très loin
majoritaire, et que la conception doit traiter comme le cas normal et non comme
une contrainte secondaire :

- L'écran d'entrée du module n'est pas toujours Suggestions : la mémorisation
  du dernier volet, ajoutée le 2026-10-08, peut faire atterrir sur « Mes
  recettes ».
- La barre d'orientation occupe **la moitié de l'écran** : quatre rangées de
  pastilles avant la première recette.
- Les titres de recettes sont tronqués sur une ligne : on ne peut pas lire ce
  qu'on choisit.

## 2. Décisions

**D1 — Suggestions est l'écran d'entrée, toujours.** La mémorisation du dernier
volet est retirée. L'onglet « Recettes » ouvre Suggestions ; « Mes recettes »
reste à une tape, par la bascule.

**D2 — Une question bloquante au départ.** À l'ouverture, l'écran demande le
type de plat — entrée, plat, dessert, etc. Aucune recette n'est affichée avant
la réponse. djkix a choisi cette variante en connaissant son coût : une tape
de plus à chaque visite.

**D3 — Cette première réponse oriente la recherche initiale.** Elle part à
Gemini avec la demande. Ce n'est pas une relance : un appel a lieu de toute
façon, et sans cela répondre « Dessert » pourrait donner une liste vide juste
après avoir répondu — le pire enchaînement possible. Arbitrage pris par Claude,
les deux réponses de djkix ne le déterminant pas à elles seules.

**D4 — Les changements suivants filtrent la fournée, sans appel.** Conforme au
choix du 2026-10-08 : gratuit et instantané. Quand le filtre ne laisse rien, le
bouton de recherche ciblée existant reste proposé — la relance reste un geste
explicite.

**D5 — Quatre menus déroulants sur une seule ligne.** Type, Cuisine, Durée,
Facilité. Sélecteurs natifs : au téléphone, ils ouvrent une roue pleine largeur,
confortable au pouce, et l'écran ne perd qu'une ligne au lieu de quatre rangées.

**D6 — Les titres de recettes tiennent sur deux lignes.** Lisibles, jamais
tronqués au premier mot.

## 3. Exigences

**A1.** L'onglet « Recettes » ouvre toujours Suggestions. Le stockage du
dernier volet et son repli sont supprimés, pas seulement ignorés.

**A2.** À l'arrivée sur Suggestions sans type choisi, l'écran pose la question
et n'affiche ni liste, ni squelette de liste, ni barre de filtres. La question
nomme les sept types de la taxonomie existante (`DISH_TYPES`).

**A3.** Le type choisi part dans la requête initiale comme orientation.

**A4.** Une fois la fournée affichée, les quatre filtres tiennent sur une ligne.
Changer le type de plat **ne relance rien** : il filtre la fournée. Changer la
cuisine, la durée ou la facilité conserve le comportement actuel.

**A5.** Un moyen de revenir à la question — pour repartir d'un autre type sans
recharger l'application.

**A6.** Le titre d'une carte de suggestion s'affiche sur deux lignes au plus,
sans troncature au milieu d'un mot. Même traitement sur les cartes de « Mes
recettes », qui souffrent du même défaut.

**A7.** Toute cible tactile reste à `min-h-touch`. Un sélecteur natif satisfait
cette contrainte par sa hauteur, pas par sa police.

## 4. Ce que ce lot ne fait pas

- Pas de changement du contenu des suggestions ni du prompt.
- Pas de changement de la recherche web, toujours refusée par le palier gratuit.
- Pas de refonte des filtres de « Mes recettes », dont les rangées de pastilles
  restent en l'état : seul l'écran Suggestions est visé, plus le titre des
  cartes (A6).
