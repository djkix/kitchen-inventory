# Favoris et note directe sur une recette

**Statut :** décisions prises par Franck le 2026-10-08, à exécuter.
**Demande :** « je dois pouvoir ajouter des recettes en favoris (picto étoile) et je veux pouvoir les noter mais je ne comprends toujours pas où se trouve la notation ».

## 1. Le problème constaté

La notation existe, mais elle n'appartient pas à la recette : `RecipeRating`
est rattaché à un `RecipeLog`, c'est-à-dire à une fois où l'on a cuisiné. Tant
qu'aucune réalisation n'est enregistrée, il n'existe aucun bouton « Noter »
nulle part, et l'historique ne s'affiche même pas. Franck cherchait à noter une
recette ; l'application ne savait noter qu'un repas.

Les favoris, eux, n'existent pas du tout.

## 2. Décisions

**D1 — Note directe sur la recette.** Des étoiles sur la fiche, utilisables
immédiatement, sans réalisation préalable.

**D2 — Les deux notations coexistent.** La note par réalisation reste : c'est
l'avis sur un repas réel, et le socle prévoit une note par membre du foyer. La
note directe est l'avis général sur la recette.

**D3 — La note directe prime à l'affichage.** Sur les cartes et dans le tri,
c'est elle qui compte quand elle existe ; la moyenne des réalisations prend le
relais sinon. Une seule note visible à la fois, jamais deux chiffres
concurrents sous les yeux.

**D4 — Favoris partagés par le foyer.** Une seule liste, pas de favori par
personne. Franck a tranché ainsi en connaissant le revers : un membre peut
retirer le favori d'un autre.

**D5 — Le favori est indépendant de la note.** On peut adorer une recette
compliquée sans vouloir la retrouver chaque semaine, et marquer une recette
banale qu'on fait tout le temps.

## 3. Exigences

**A1.** `Recipe` gagne `favorite Boolean @default(false)` et
`rating Int?` (1 à 5). Migration Prisma versionnée, `0008`.

**A2.** Une étoile à cocher sur la fiche d'une recette et sur chaque carte de
« Mes recettes ». État coché visible autrement que par la couleur (étoile
pleine contre étoile vide), et annoncé (`aria-pressed`).

**A3.** Cinq étoiles de notation sur la fiche, utilisables sans réalisation.
Une note posée se corrige, et se retire.

**A4.** Pastille « Favoris » dans la première rangée de filtres de « Mes
recettes », à côté de « Déjà faites ».

**A5.** Le tri par note existant (`rating`) utilise la note directe quand elle
existe, la moyenne des réalisations sinon — même règle que l'affichage (D3),
écrite une seule fois dans `packages/shared`.

**A6.** La fiche d'une recette jamais cuisinée n'affiche plus un historique
vide sans explication : elle dit qu'aucune réalisation n'est enregistrée, et
que la note directe reste possible.

## 4. Ce que ce lot ne fait pas

- Pas de favori par personne (D4).
- Pas de suppression de la note par réalisation (D2).
- Pas de commentaire libre sur la note directe : les étoiles seules.
