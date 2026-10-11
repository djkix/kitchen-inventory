# Suggestions : parcours dirigé et filtres compacts sur mobile

**Statut :** décisions prises par djkix le 2026-10-11, exécutées ; amendées le
2026-10-11 en revue finale (section 5).
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
explicite. Ne concernait que le type de plat : la cuisine, la durée et la
facilité ont toujours relancé une vraie recherche (décision du 2026-10-04,
inchangée). **Retirée le 2026-10-11, voir l'amendement en section 5 :** le
type de plat relance désormais lui aussi, la fournée mono-type résultant de
D3 rendant un filtre local sur ce seul type impossible à honorer sans
objet.

**D5 — Quatre menus déroulants sur deux lignes de deux (amendé le 2026-10-11,
voir section 5).** Type, Cuisine, Durée, Facilité. Sélecteurs natifs : au
téléphone, ils ouvrent une roue pleine largeur, confortable au pouce. La
version du 2026-10-11 prévoyait une seule ligne ; la revue a calculé qu'à
375 px, quatre sélecteurs sur une seule ligne ne laissaient qu'environ 45 px
de texte utile chacun — trop peu pour « Latino-américaine » ou
« Petit-déjeuner », qui existent réellement dans les taxonomies. Deux lignes
de deux, vérifiées au navigateur à 375 px, tiennent sans troncature pour un
coût d'environ 40 px de hauteur supplémentaire — l'essentiel du gain d'espace
de la fusion sans sacrifier la lisibilité, qui était l'objet de la demande.

**D6 — Les titres de recettes tiennent sur deux lignes.** Lisibles, jamais
tronqués au premier mot.

## 3. Exigences

**A1.** L'onglet « Recettes » ouvre toujours Suggestions. Le stockage du
dernier volet et son repli sont supprimés, pas seulement ignorés.

**A2.** À l'arrivée sur Suggestions sans type choisi, l'écran pose la question
et n'affiche ni liste, ni squelette de liste, ni barre de filtres. La question
nomme les sept types de la taxonomie existante (`DISH_TYPES`).

**A3.** Le type choisi part dans la requête initiale comme orientation.

**A4.** Une fois la fournée affichée, les quatre filtres tiennent sur deux
lignes de deux (amendé le 2026-10-11, voir D5 et section 5). **Amendé le
2026-10-11 (section 5) :** changer le type de plat relance désormais une
recherche, exactement comme la cuisine, la durée et la facilité — la version
du 2026-10-11 prévoyait qu'il filtre seul la fournée déjà chargée (D4),
devenue inapplicable par la fournée mono-type que produit D3.

**A5.** ~~Un moyen de revenir à la question — pour repartir d'un autre
type sans recharger l'application.~~ **Superseded le 2026-10-11 (section
5) :** le sélecteur de type de plat de la barre de filtres (A4) couvre
désormais ce besoin lui-même — changer de type s'y fait directement, sans
repasser par la question bloquante. Le bouton dédié qui satisfaisait A5 a
été retiré : il faisait doublon avec ce sélecteur, pour un coût d'écran
(une ligne entière) que la fournée mono-type ne justifiait plus.

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

## 5. Amendement du 2026-10-11 (revue finale) — le type de plat relance, D4 retirée

**Constat.** D3 fait partir la première réponse (le type de plat) dans la
requête initiale : le modèle reçoit la consigne « Ne propose que des recettes
de type X » (`apps/api/src/suggestions/prompt.ts`), et la fournée devient donc
**mono-type**. Personne ne l'avait anticipé au moment d'écrire D3 : D4 avait
été décidée le 2026-10-08, quand la fournée restait mélangée (huit types
possibles dans un même lot), et n'a pas été rouverte quand cette prémisse a
changé le 2026-10-11 avec D2/D3. Conséquence pratique : le sélecteur « Type de
plat » de la barre (D4, filtre local gratuit) ne pouvait plus que choisir
entre « ne rien faire » (sélectionner le type déjà envoyé au modèle, puisque
toute la fournée en est déjà) et « tout vider » (sélectionner n'importe quel
autre type, absent par construction de la fournée mono-type) — un contrôle
mort.

**Décision.** Le sélecteur « Type de plat » devient le contrôle unique du
type, et relance une recherche orientée, exactement comme les trois autres
(cuisine, durée, facilité). D4 est retirée : plus aucune dimension de la
barre ne filtre localement, les quatre relancent.

**Conséquences, par exigence :**

- **A4** amendée : le type de plat relance au lieu de filtrer.
- **A5** rendue sans objet et retirée : le sélecteur, qui relance désormais,
  couvre lui-même le besoin de « repartir d'un autre type » que servait le
  bouton dédié « Relancer une recherche avec un autre type de plat ». Ce
  bouton est supprimé — il faisait doublon et coûtait une ligne entière
  (56 px) sur un écran de téléphone.
- L'état vide dédié « Aucun [type] dans cette fournée » et son bouton
  « Chercher des [type]s » disparaissent avec le filtre local qu'ils
  accompagnaient : une recherche orientée par type ne peut plus rendre un
  autre type à filtrer, ce cas ne peut donc plus se produire.
- Le sélecteur doit refléter le type déjà en vigueur dès l'arrivée sur la
  fournée (valeur initiale = réponse à la question), au lieu d'afficher
  « Tous les types » juste après que l'utilisateur a répondu.
- Le type de plat compte désormais dans le total d'orientations actives
  affiché par la barre (`countActiveOrientation`) et est remis à zéro par
  « Tout effacer », comme les trois autres — avant ce correctif, la barre
  affichait « Aucune orientation » alors que le type contraignait déjà toute
  la fournée.

**Chemin de repli vérifié.** Sans le bouton dédié, la question bloquante
(D2) ne redevient accessible que par un rechargement complet de
l'application — qui réinitialise ensemble la réponse mémorisée (variable de
module, voir `dish-type-question.tsx`) et l'orientation de l'écran. Répondre
ensuite au même type qu'avant le rechargement relance donc normalement une
recherche fraîche (plus de données en cache, nouvel état), sans écran figé
sans explication. Une garde (`refresh: true` pour une seule requête, jamais
reporté sur les gestes suivants) protège par ailleurs tout chemin de retour à
la question qui serait réintroduit plus tard avec une orientation déjà
présente — voir `nextOrientationAfterDishTypeAnswer` dans
`suggestions-screen.tsx`.

**Correctif associé, hors périmètre de D3/D4 mais découvert à cette
occasion : `refresh` ne doit jamais survivre à l'orientation qui l'a demandé.**
Avant ce correctif, le seul endroit qui posait `refresh: true` (le bouton
« Chercher des [type]s », maintenant supprimé) ne le retirait jamais : tout
geste suivant sur la barre (cuisine, durée, facilité, ou le type lui-même)
en aurait hérité, contournant le cache serveur de 24 h et consommant quota et
euros à chaque geste au lieu du seul qui le justifiait. `orientation-bar.tsx`
pose désormais `refresh: undefined` explicitement à chaque changement normal.
