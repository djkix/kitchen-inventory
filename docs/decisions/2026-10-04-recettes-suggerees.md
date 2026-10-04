# Recettes suggérées à partir du stock

2026-10-04 · Franck, avec assistance de Claude

Le cahier des charges (`docs/cahier-des-charges.md`) fait autorité. Les choix
laissés au jugement pour cet incrément (composition du point de départ depuis
le stock, recherche web et composition par Gemini, orientation par région,
durée ou facilité, conservation au format de l'application, retrait de la
création manuelle) et leurs dix-sept arbitrages sont documentés dans
`docs/specs/2026-10-04-recettes-suggerees.md`, qui fait référence : ils ne
sont pas recopiés ici.

## Pourquoi l'approche a changé

À la livraison du socle (0.7.0), Franck a indiqué que le module ne répondait
pas à sa question : il avait demandé à pouvoir cuisiner avec ce qu'il a en
stock, pas un carnet de recettes qu'il faudrait d'abord remplir lui-même. Le
socle livrait précisément ce carnet — saisie manuelle, stock comme simple
filtre.

Cet incrément inverse le point de départ : c'est le stock qui déclenche la
recherche, auprès du web et d'un modèle, et la bibliothèque du foyer
(« Mes recettes ») devient le résultat d'un choix recette après recette,
plutôt que son point de départ. Conséquence assumée et documentée dans la
spécification (arbitrage **B13**) : la création manuelle disparaît, le
formulaire ne sert plus qu'à modifier une recette déjà conservée — une
recette de famille absente du web n'a plus sa place dans l'application.

## Amendement du cahier des charges

Le cahier des charges a été amendé le 2026-10-04 (section 26, « Journal des
amendements ») : la suggestion assistée depuis le stock devient la porte
d'entrée du module recettes (section 12, EF-25, EF-26), et EF-27 (tri par
défaut sur le stock, retenu puis abandonné au profit de la note dès
l'amendement du 2026-10-03) est retirée. Voir la spécification pour le détail
des exigences concernées et des dix-sept arbitrages.

## Durée d'une recette conservée

La fournée n'annonce qu'une durée **totale** (`totalMinutes`), sans séparer
préparation et cuisson. À la conservation, elle est portée entière en
`prepMinutes` (`apps/api/src/suggestions/suggestions.service.ts`) : une recette
surtout faite de temps de four ressort donc plus difficile qu'elle ne l'est au
barème du foyer (`computeDifficulty`, B15), qui pèse le temps de préparation.
Choix assumé faute de détail dans la réponse du modèle ; le corriger demanderait
de lui demander les deux durées séparément, hors périmètre de cet incrément.
