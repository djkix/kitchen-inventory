# Qualité des recettes proposées (2026-11-20)

Le propriétaire a signalé l'écart : les recettes de l'écran Suggestions sont
« basiques, limite qui n'existent pas », là où les mêmes demandes posées à la
main dans l'application Gemini rendent des plats structurés, « avec ail,
échalote, etc. ».

## Ce que disait la base de production

- `SuggestionPoolRecipe` : **399 recettes, toutes `ai`**, aucune issue du web.
  Moyennes : **3,5 ingrédients** et **4,3 étapes**.
- Dernières entrées : « Wraps croustillants au concentré de tomate et
  abricots » (3 ingrédients), « Galettes de blé en sauce tomate à la
  coriandre » (3), « Bouillon relevé aux galettes de blé et ananas » (4).
- `GeminiCall` sur 21 jours : **21 appels sur 23 chez `gemini-3.5-flash-lite`**,
  les deux autres chez `gemini-3.1-flash-lite` et `gemini-3.5-flash`.
- `Setting` : `suggestionWebSearch = false`.

Trois causes, donc, et non une.

## D1 — Les Flash repassent devant les Flash-Lite

`orderModels` classait les Flash-Lite en tête depuis le 2026-11-09, sur demande
du propriétaire : eux seuls répondaient quand Google saturait ses modèles
récents, et « composer trois recettes à partir d'une liste d'ingrédients ne
demande pas un gros modèle ».

Cette dernière prémisse était fausse. Composer une recette est la seule tâche
de l'application dont la **qualité** se voit : la lecture d'un code-barres, le
rapprochement d'une ligne de ticket et la reconnaissance d'une photo réussissent
ou échouent, une recette, elle, peut réussir et être mauvaise. Flash-Lite est le
modèle le plus faible de la liste, et c'est lui qui a écrit les 399 recettes.

L'inversion ne perd rien de ce que le 2026-11-09 avait gagné : un 503 écarte le
modèle cinq minutes et la cascade passe au suivant, donc les Flash-Lite restent
disponibles derrière. Le coût est l'attente — 65 s contre 3,7 s au relevé —
devenue supportable depuis la notification de résultat (EF-31), qui permet de
quitter l'écran.

## D2 — La consigne autorise un placard de base

Le prompt ne nommait que les huit graines tirées du stock, et le modèle s'y
tenait à la lettre : ni ail, ni échalote, ni beurre, parce que personne ne les
avait scannés. Un foyer n'inventorie pas son sel.

La consigne système liste désormais ce qu'il peut supposer présent — sel,
poivre, sucre, huile, beurre, vinaigre, farine, oignon, ail, échalote,
moutarde, bouillon, crème, lait, œufs, herbes et épices courantes — avec
obligation de les faire figurer dans la liste d'ingrédients quand la recette
les emploie, pour que le rapprochement au stock et la couverture restent
justes.

Écarté : tirer cette liste du stock réel. Elle doit valoir même quand le
placard n'a jamais été scanné, ce qui est précisément le cas.

## D3 — La consigne dit à quoi ressemble une recette finie

Rien ne l'exigeait : trois ingrédients et trois étapes satisfaisaient la
demande aussi bien que douze. Le plancher est désormais **six ingrédients et
cinq étapes**, avec base aromatique revenue, assaisonnement nommé, et
quantités pour quatre personnes sauf demande contraire.

Quatre personnes est une valeur fixe, pas un réglage : le cahier des charges ne
prévoit pas de taille de foyer, la recette n'a pas de champ `servings`, et
l'inventer demanderait une migration pour un gain que personne n'a demandé.
À revoir le jour où quelqu'un le demandera.

Le plancher vit dans la consigne, jamais dans le schéma : une recette `web`
vient d'une page réelle et n'a pas à s'y plier, et rejeter une réponse déjà
facturée parce qu'elle compte cinq ingrédients coûterait plus que de la garder.

## D4 — Le stock est une réserve, pas une liste à épuiser

La formulation « ingrédients disponibles dans le foyer », suivie d'une
injonction de diversité et de l'interdiction de reproposer quarante titres
connus, poussait le modèle vers des mariages absurdes : tout ce qui était nommé
devait servir, et il fallait que ce soit nouveau. D'où les wraps au concentré
de tomate et aux abricots.

La consigne dit maintenant l'inverse : laisser de côté ce qui n'a rien à faire
dans le plat, une recette qui emploie trois ingrédients et donne envie valant
mieux qu'une qui les case tous.

## D5 — La recherche web reste un réglage, non rallumé d'office

Le réservoir ne contient aucune recette `web` parce que `suggestionWebSearch`
est à `false`. L'interrupteur est dans **Réglages › Recherche web des
recettes**, réservé aux administrateurs, et son activation **exige la
facturation sur le projet Google Cloud** : sans elle, les recherches sont
refusées et l'écran reste vide. Ce n'est donc pas un correctif à livrer mais
une condition à remplir côté Google, laissée au propriétaire.

La taille de fournée en mode web (douze) n'a pas été touchée. Elle risque de
dépasser le délai de 120 s avec des recettes plus longues sur un modèle plus
lent, mais le mode est éteint : la régler maintenant serait deviner, et cela
démontait le scénario figé qui épingle le rapprochement sur douze recettes.
À mesurer le jour où la recherche web servira vraiment.

## Ce qui n'est pas garanti

Rien ici ne prouve que les recettes seront bonnes : la consigne et le modèle
rendent le résultat probable, pas certain. Le seul contrôle automatique
possible porte sur le texte envoyé — c'est ce que font les tests ajoutés à
`gemini-suggestion.provider.spec.ts`. Le reste se juge dans l'assiette.
