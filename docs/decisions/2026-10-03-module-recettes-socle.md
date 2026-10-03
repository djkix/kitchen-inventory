# Module recettes — socle

2026-10-03 · Franck, avec assistance de Claude

Le cahier des charges (`docs/cahier-des-charges.md`) fait autorité. Les choix
laissés au jugement pour le socle du module recettes (saisie par le foyer,
couverture depuis le stock réel, filtres et tri, cuisson avec décrément,
historique et notation, archivage) et leurs 27 arbitrages sont documentés
dans `docs/specs/2026-10-03-module-recettes-socle.md`, qui fait référence :
ils ne sont pas recopiés ici.

## Périmètre remonté au lot 2

À la demande de Franck, trois exigences initialement prévues pour un
incrément ultérieur ont été explicitement remontées dans le périmètre du
lot 2, aux côtés des seuils et de la liste de courses, des alertes de
péremption et du mode hors ligne :

- **EF-24**, ajouter les ingrédients manquants d'une recette à une liste de
  courses — dépend de l'existence de cette liste, absente du socle ;
- **EF-25**, importer une recette depuis une URL ;
- **EF-26**, générer une recette par IA.

Le socle livré affiche les ingrédients manquants sur la fiche recette mais ne
propose pas de bouton d'ajout, et ne couvre ni l'import ni la génération.

## Amendement du cahier des charges

Le cahier des charges a été amendé le 2026-10-03 sur le tri par défaut de
l'écran Recettes (sections 12 et 14, exigence EF-27) : la priorité donnée au
stock et aux produits proches de leur date, initialement demandée par ces
sections, cède la place à un tri par défaut sur la note du foyer, le stock et
l'anti-gaspillage restant accessibles par les tris et pastilles dédiés. Voir
la section 26 du cahier des charges, « Journal des amendements », et la
section 10 de la spécification du socle pour le détail de l'écart levé par
cet amendement.
