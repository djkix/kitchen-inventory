# « Mes recettes » et la fiche recette, repris pour le mobile

**Date** : 2026-10-19
**Demande de Franck**, en trois volets :

1. « Ajouter à mes recettes » au lieu de « Plus d'informations ».
2. Sur la liste : « un menu de filtre (actuellement ça prend trop de place sur
   la page surtout sur un mobile), n'affiche pas "trier par", permet
   l'effacement d'une recette avec un swipe vers la gauche + confirmation
   d'effacement de mes recettes (mais toujours présent dans la base des
   recettes) ».
3. Sur la fiche : « ne pas afficher la note du foyer (trop de place), remonte
   le nb de parts au niveau du bloc avec les infos préparation, et mets les
   infos (temps, facile) avec des blocs de couleur pour les identifier ».

**Exigences touchées** : EF-21, EF-22, EF-23, EF-25.

## Décisions

**D1 — Le bouton dit ce qu'il fait.** « Plus d'informations » devient
**« Ajouter à mes recettes »**. Le libellé actuel vient d'un arbitrage du
2026-10-08 (« simple renommage » de « Conserver »), et il a produit exactement
l'ambiguïté qu'on pouvait craindre : le mot promet une lecture, l'action est un
enregistrement définitif. Franck a buté dessus le 2026-10-19 en demandant ce
que ce bouton apportait « par rapport à la fenêtre d'affichage de la recette ».

**D2 — Les filtres passent derrière un bouton.** Un seul contrôle
« Filtres » sur la ligne de recherche, portant le nombre de filtres actifs ;
il ouvre un panneau par le bas. Les six sélecteurs et les cinq bascules y
vivent, inchangés. Rien n'est retiré : c'est la place permanente qui disparaît,
pas la fonction. Sur un téléphone, la liste des recettes doit commencer en haut
de l'écran.

**D3 — « Trier par » disparaît de l'écran.** Demande explicite. Le tri reste
dans le modèle et dans les préférences enregistrées — seul le sélecteur
disparaît. Le tri appliqué demeure celui que le foyer a mémorisé, par défaut la
note.

**D4 — Effacer, c'est archiver.** « Toujours présent dans la base des
recettes » décrit exactement ce que fait `POST /recipes/:id/archive`, qui
existe depuis le socle : la recette quitte la liste, conserve son historique et
ses notes, et reste consultable par la bascule « Archivées ». Aucune route
nouvelle, aucune suppression réelle, aucune migration.

**D5 — Le geste est un glissement vers la gauche, suivi d'une confirmation.**
Le glissement seul n'efface jamais : il découvre une action rouge, qu'il faut
toucher, et qui demande confirmation. Deux raisons de ne pas s'en tenir au
glissement : il se déclenche par accident en faisant défiler une liste au
pouce, et il n'existe pas au clavier. **Une action équivalente doit donc rester
atteignable sans glisser** — sinon la fonction n'existe pas pour un lecteur
d'écran ni pour une souris.

**D6 — Une recette archivée ne redevient pas une suggestion.** Elle a été
conservée délibérément puis écartée : la reproposer serait la pire réponse
possible. L'exclusion des recettes du foyer hors du réservoir (D7 de la spec du
2026-10-15) continue de s'appliquer, archivées comprises.

**D7 — La note du foyer quitte la fiche.** Demande explicite : elle prend trop
de place. Les cinq étoiles de notation directe disparaissent de l'affichage ;
la note reste **lisible sur les cartes** de « Mes recettes » et reste le tri par
défaut. La notation après cuisson, par personne, n'est pas touchée : elle vit
dans l'historique.

**D8 — Le nombre de parts rejoint le bloc des durées.** Il est aujourd'hui
isolé ; il rejoint préparation et cuisson, avec lesquels il forme une seule
lecture (« pour combien, et combien de temps »). Il reste ajustable, et ce même
nombre continue de préremplir le tiroir de cuisson — un seul nombre du début à
la fin.

**D9 — Durée et difficulté deviennent des blocs colorés.** Repérage visuel, pas
décoration : la difficulté suit une échelle (du plus facile au plus exigeant) et
la durée une autre. **La couleur ne porte jamais l'information seule** — le
texte reste lu, pour le daltonisme comme pour le mode sombre.

## Limites assumées

- Le glissement n'est pas découvrable : rien n'indique qu'il existe. C'est le
  cas de tous les glissements de liste ; l'action atteignable autrement (D5)
  évite que la fonction soit perdue, pas qu'elle soit discrète.
- Masquer le tri (D3) laisse le foyer sur le tri mémorisé sans moyen d'en
  changer depuis cet écran. Assumé, c'est la demande ; le panneau de filtres
  est l'endroit naturel où le remettre si le besoin revient.
