# Recettes : complétude des informations et usage quotidien

**Statut :** à valider par Franck
**Demande :** Franck, 2026-10-08, six corrections sur le parcours recettes.
**Cahier des charges :** sections 12 et 14, EF-21, EF-23, EF-25, EF-26.

## 1. Intention

Les suggestions sont arrivées à l'écran, mais elles ne sont pas encore
*utilisables en cuisine* : une recette composée par le modèle ne dit ni à quelle
température, ni combien de temps, ni sur quel feu ; on ne voit pas où est rangé
l'ingrédient qu'on a pourtant « disponible » ; et on ne retrouve pas ce qu'on a
déjà cuisiné ni ce qu'on en avait pensé.

Ce lot ferme ces écarts. Il n'ajoute aucune fonctionnalité nouvelle au sens du
cahier : il rend exploitable ce qui existe.

## 2. Ce qui existe déjà et ne sera pas refait

Vérifié dans le code le 2026-10-08, pour ne pas reconstruire par-dessus :

- `Recipe.cookMinutes` existe, distinct de `prepMinutes`. Les suggestions ne le
  remplissent jamais : toute la durée est portée en préparation.
- `RecipeSummaryDto.stats` porte déjà la note moyenne, le nombre de
  réalisations et la tendance. Les cartes de « Mes recettes » ne les affichent
  pas.
- La cuisson met déjà les quantités à l'échelle (`servingsCooked`, ratio dans
  `cook-sheet.tsx`) et décrémente en conséquence. Ce qui manque est le choix du
  nombre de parts **avant** la cuisson, à la sélection de la recette.
- `Location.temperature` (`ambient` / `chilled` / `frozen`) existe : c'est la
  clé de couleur naturelle pour les pastilles d'emplacement, plutôt qu'une
  palette arbitraire par emplacement.

## 3. Exigences

### A. Complétude des recettes composées par l'IA

**A1.** Chaque étape d'une recette composée par le modèle doit porter, quand
c'est pertinent, la température du four en °C, l'intensité du feu (doux, moyen,
vif) et la durée de l'étape. Une étape de cuisson sans aucune de ces trois
informations est une étape inexploitable.

**A2.** Les étapes restent des chaînes de caractères (`steps: string[]`). La
contrainte passe par le prompt système, pas par le schéma : découper une étape
en champs structurés (`temperature`, `heat`, `minutes`) obligerait le modèle à
ranger dans des cases ce qui se dit naturellement en une phrase, et casserait
le format de fournée déjà en production.

**A3.** La fournée rend désormais `prepMinutes` et `cookMinutes` séparément, en
plus de `totalMinutes`. Une recette conservée les porte dans les champs du même
nom, qui existent déjà et restaient vides.

**A4.** Vaut pour les recettes composées par le modèle (`provenance: 'ai'`)
**et** pour la réécriture d'une page web conservée : une page mal structurée
dont on extrait trois lignes vagues pose le même problème en cuisine.

### B. Identification visuelle des ingrédients

**B1.** Dans la liste d'ingrédients — fiche de suggestion comme fiche de
recette — chaque ligne rapprochée d'un produit du stock affiche la **photo de
ce produit**, alignée à droite de la ligne.

**B2.** Une ligne sans produit rapproché n'affiche pas de photo, et pas non plus
de cadre vide : rien, pour que l'œil ne s'arrête que là où il y a quelque chose
à reconnaître.

**B3.** La photo est décorative : elle double une information déjà écrite (le
nom du produit). Elle porte donc `alt=""` et n'entre pas dans le nom accessible
de la ligne.

### C. Emplacement de l'ingrédient

**C1.** À côté de l'état « disponible », chaque ligne affiche une **pastille
d'emplacement** nommant l'endroit où le produit est rangé.

**C2.** La couleur de la pastille vient de `Location.temperature`, pas d'une
couleur par emplacement : ambiant, frais, congelé. Trois couleurs stables,
porteuses de sens, qui n'ont pas à être choisies ni maintenues emplacement par
emplacement.

**C3.** La couleur ne porte jamais seule l'information : le nom de
l'emplacement est écrit dans la pastille (section 14, accessibilité).

**C4.** Un ingrédient disponible dans plusieurs emplacements affiche celui du
lot qui sera consommé en premier, selon la règle de consommation déjà en place.

### D. Retrouver ses recettes et ses notes

**D1.** Les cartes de « Mes recettes » affichent la **note moyenne du foyer** et
le **nombre de réalisations**. Les données sont déjà dans `RecipeSummaryDto`.

**D2.** Une recette jamais réalisée n'affiche ni note ni compteur — pas de
« 0 fois », pas d'étoiles vides : l'absence de trace se lit mieux que la trace
d'une absence.

**D3.** Une pastille rapide **« Déjà faites »** rejoint la première rangée de
filtres, à côté de « Dignes de confiance » et « Prêtes ».

**D4.** La notation cesse d'être réservée au tiroir de validation de cuisson :
la fiche d'une recette déjà réalisée permet de noter ou corriger sa note
directement, sans repasser par une cuisson.

**D5.** Pas de nouvel écran d'historique. L'information rejoint les deux
endroits où Franck la cherche déjà : la liste et la fiche.

### E. Vocabulaire du tiroir de suggestion

**E1.** Le bouton principal du tiroir d'une suggestion s'intitule **« Plus
d'informations »** et non « Conserver ».

**E2.** Ce n'est pas qu'un libellé : le geste change de nature. Le tiroir sert
à en savoir plus avant de décider, la conservation devient la conséquence de
cette consultation, proposée une fois les informations complètes affichées.

### F. Nombre de parts

**F1.** À la sélection d'une recette — suggestion ou recette du foyer — le
nombre de parts est ajustable, initialisé à celui de la recette.

**F2.** Les quantités affichées sont recalculées au prorata.

**F3.** La **couverture est recalculée** sur ces quantités : une recette prête
pour quatre ne l'est pas forcément pour huit, et l'écran ne doit pas continuer
d'annoncer « Prête à 100 % » quand le stock ne suit plus.

**F4.** Le nombre choisi est repris par défaut au moment de cuisiner, qui
continue de décrémenter le stock sur cette base. Un seul nombre de parts du
début à la fin, jamais deux à tenir.

## 4. Arbitrages

| # | Question | Décision | Motif |
| --- | --- | --- | --- |
| 1 | Étapes structurées ou texte enrichi ? | Texte enrichi, contrainte par le prompt | Un modèle rédige mieux « à feu moyen 8 minutes » qu'il ne remplit trois champs ; et le format de fournée reste compatible |
| 2 | Photo sur les cartes de recettes ? | Non, uniquement par ingrédient | Une recette n'a pas de photo à elle ; emprunter celle d'un ingrédient représenterait mal le plat (réponse de Franck) |
| 3 | Couleur des pastilles d'emplacement | Par température, pas par emplacement | Trois couleurs qui veulent dire quelque chose, et rien à maintenir quand un emplacement est créé |
| 4 | Écran d'historique dédié ? | Non | L'application compte déjà sept écrans ; l'information rejoint là où elle est cherchée (réponse de Franck) |
| 5 | Portions : affichage seul ou tout ? | Affichage, couverture et cuisson | Un écran qui annonce autre chose que ce que fera le stock est pire que pas de réglage du tout (réponse de Franck) |
| 6 | Recettes déjà en base | Non régénérées | Les durées et étapes existantes restent telles quelles ; seules les nouvelles fournées portent la complétude. Régénérer coûterait un appel par recette pour un gain incertain |
| 7 | Signature de cache | Passe à `v3` | Les fournées stockées ne portent ni `prepMinutes` ni `cookMinutes` séparés |

## 5. Ce que ce lot ne fait pas

- Pas de liste de courses (EF-24, lot 2).
- Pas de photo propre à une recette.
- Pas de régénération des recettes déjà conservées.
- Pas de recherche web : elle reste refusée par le palier gratuit de Gemini,
  indépendamment de ce lot.

## 6. Risques

- **A1 n'est pas vérifiable automatiquement.** Aucun test ne peut garantir
  qu'un modèle a bien indiqué une température : on ne teste que la présence des
  champs de durée. La qualité des étapes se constate à l'usage.
- **F3 change une valeur affichée partout.** La couverture est la colonne
  vertébrale des suggestions (tri, groupes, pastilles) : la recalculer sur un
  nombre de parts variable touche plus de code que les cinq autres points
  réunis.
