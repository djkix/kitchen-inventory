# Suggestions à partir d'ingrédients dictés

**Date** : 2026-10-19
**Demande de djkix** : « il me faudrait, en parallèle de ce qui existe, la
possibilité que j'indique que je souhaite des recettes en fonction d'une
orientation que j'aurai. Par exemple, je pourrai dire que j'ai des pommes de
terre et un reste de merguez et que je souhaite avoir des recettes proposées
avec ces éléments (prenant en compte ce que j'ai en stock). »
**Exigences touchées** : EF-25, EF-26 (section 12).

## Le besoin, et pourquoi le stock ne suffit pas

Aujourd'hui le point de départ est tiré du stock : `pickSeedIngredients`
choisit huit ingrédients structurants, dont trois tournent d'un jour à
l'autre. djkix ne choisit rien.

Son exemple contient exactement ce qui manque : « un **reste** de merguez ».
Un reste n'est pas en stock — il ne se scanne pas, il n'a pas de code-barres,
il est né du repas d'hier. Le champ doit donc accepter du **texte libre**, et
non une sélection dans l'inventaire. C'est aussi ce qui rend la fonction utile
le soir, devant un frigo à vider.

## Décisions

**D1 — Les ingrédients dictés sont obligatoires.** Choix de djkix entre trois
options. Chaque recette proposée doit utiliser **tous** les éléments saisis.
C'est le sens de la demande : écouler des restes, pas recevoir des idées
vaguement proches. Conséquence assumée : sur une combinaison inhabituelle, le
modèle rendra peu de recettes — mieux vaut trois recettes qui utilisent
vraiment la merguez que douze qui l'ignorent.

**D2 — Le réservoir d'abord, le modèle ensuite.** Choix de djkix. Une demande
cherche d'abord dans le réservoir permanent les recettes dont les ingrédients
contiennent **tous** les termes saisis ; le modèle n'est appelé que si le
plancher de six n'est pas atteint, exactement comme le chemin existant (D6 de
la spec du 2026-10-15). Taper deux fois la même chose ne coûte donc rien la
seconde fois.

**D3 — Les ingrédients dictés entrent dans la signature.** Le verrou de 24 h
(D11 du 2026-10-15) porte sur une orientation ; une combinaison d'ingrédients
en est une. Sans cela, « pommes de terre, merguez » et « courgettes, féta »
partageraient le même verrou, et la seconde demande se verrait refuser un
appel parce que la première venait d'en consommer un. Les termes sont
normalisés et **triés** avant d'entrer dans la signature : « merguez, pommes de
terre » et « pommes de terre, merguez » sont la même demande.
`SUGGESTION_SIGNATURE_VERSION` passe à `v5`.

**D4 — Le stock reste envoyé au modèle.** « Prenant en compte ce que j'ai en
stock » : les ingrédients dictés s'**ajoutent** au point de départ tiré du
stock, ils ne le remplacent pas. Le prompt distingue les deux : ce qui est
imposé, et ce qui est disponible à défaut.

**D5 — Un ingrédient dicté n'est jamais annoncé comme manquant.** djkix vient
de déclarer qu'il l'a. Une carte qui afficherait « il vous manque : merguez »
juste après qu'il ait tapé « merguez » serait absurde. La règle de couverture
partagée n'est pas touchée — elle continue de ne connaître que le stock ; c'est
le DTO qui retire ces ingrédients de `missingLabels` et les marque comme
déclarés. Conséquence assumée : le taux de couverture affiché reste calculé sur
le stock réel, donc une recette peut afficher « 3 sur 4 » sans qu'aucun
manquant ne soit listé. Mieux vaut un chiffre prudent qu'un chiffre inventé à
partir d'une déclaration non vérifiable.

**D6 — Le champ est sur l'écran Suggestions**, au-dessus des filtres, vide par
défaut. Choix de djkix contre un mode séparé : l'écran a déjà été allégé deux
fois à sa demande, un second parcours y aurait ajouté une bascule permanente.
Vide, le champ ne change rien au comportement actuel.

**D7 — Entrée bornée.** Cinq ingrédients au plus, trente caractères chacun,
séparés par des virgules. Normalisation par `normalizeProductName`, déjà
utilisée pour dédoublonner les cuisines et les produits. Une saisie vide est
une absence de contrainte, pas une contrainte vide. Les bornes protègent la
signature, la taille du prompt et le coût du rapprochement au réservoir.

**D8 — Le rapprochement au réservoir se fait sur les libellés normalisés**,
par inclusion : un terme est présent si l'un des libellés d'ingrédient de la
recette le contient. « pomme de terre » trouve « pommes de terre nouvelles ».
C'est volontairement généreux : un faux positif coûte une recette un peu à
côté, un faux négatif coûte un appel au modèle.

## Limites assumées

- **Le modèle peut mentir.** Rien ne garantit qu'une recette rendue utilise
  réellement ce qui était imposé ; la consigne est ferme mais probabiliste. Le
  filtrage à la lecture du réservoir (D8) rattrape le cas pour les demandes
  suivantes, pas pour la fournée qui vient d'arriver.
- **Une combinaison très inhabituelle rendra peu ou rien.** C'est le prix de
  D1. L'écran doit le dire plutôt que d'afficher une liste vide et muette.
- **Les ingrédients dictés ne sont pas mémorisés.** Chaque demande repart de
  zéro ; aucune liste de « restes » n'est tenue. Si l'usage montre que la même
  saisie revient, ce sera une évolution, pas une correction.
