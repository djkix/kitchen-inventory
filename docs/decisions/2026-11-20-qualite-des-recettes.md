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

### D1 bis — Annulé le jour même

Mis en service, l'ordre inverse a échoué. Le journal complet des appels, que
j'aurais dû lire avant de décider et non après, dit pourquoi :

| modèle | 200 | 503 | sans statut | durée |
| --- | --- | --- | --- | --- |
| `3.8-flash` | **0** | 7 | 10 | 6,4 s / 45 s |
| `3.7-flash` | **0** | 5 | 2 | 7,7 s / 120 s |
| `3.6-flash` | **0** | 3 | 2 | 8,4 s / 45 s |
| `3.5-flash` | 1 | 3 | 0 | 70,3 s |
| `3.5-flash-lite` | **21** | 1 | 0 | **7,1 s** |

Une réussite en trente-quatre tentatives côté Flash, en soixante-dix secondes.
Le raisonnement de D1 portait sur la capacité des modèles ; la question qui
décidait était leur disponibilité, et elle avait déjà été tranchée le
2026-11-09 par la mesure. Le choix du propriétaire était le bon.

Le prix s'est payé à l'écran : la cascade enchaînait les refus et **le
mandataire inverse coupe la connexion à 90 secondes**. L'application ne connaît
pas cette borne — son propre délai vaut 120 secondes — donc elle ne pouvait ni
la respecter ni l'expliquer : l'utilisateur recevait « Erreur du serveur,
réessayez dans un instant », sans rien dans le journal applicatif qu'un
`request aborted` à 90 000 ms.

L'ordre du 2026-11-09 est rétabli. Les 90 secondes du mandataire sont notées
ici parce qu'elles valent pour tout appel long, pas seulement celui-ci : elles
sont la vraie borne du produit, et elles ne sont écrites nulle part dans la
configuration de l'application.

### D1 ter — Un budget de temps pour la cascade

Question du propriétaire : « dès que tu reçois le code erreur, tu switches,
possible ? » La bascule existait déjà et elle est immédiate — un 503 passe au
modèle suivant sans attendre. Les 20,7 s du `3.8-flash` ce matin sont le temps
que Google a mis à refuser, pas une attente de l'application.

Le cas sans sortie était l'autre : `3.7-flash` n'a **rien** répondu et a
consommé ses 120 s. On ne peut pas distinguer un modèle muet d'un modèle lent
sans lire la réponse en flux, et raccourcir le délai par appel couperait des
générations honnêtes — 65 s mesurées pour six recettes le 2026-11-09.

D'où un budget d'ensemble, `CASCADE_BUDGET_MS` = 80 s : chaque tentative garde
`GENERATION_TIMEOUT_MS`, mais jamais plus que ce qui reste du budget, et la
cascade n'engage pas un modèle de plus quand il ne reste rien. Le premier
modèle essayé répond en 7 s : le budget ne mord que sur les cascades déjà mal
engagées. 80 s parce que le mandataire coupe à 90 : l'application rend alors
son propre refus, en français, avec l'heure de reprise.

Écarté : lire la réponse en flux (`streamGenerateContent`) pour n'accorder que
quelques secondes au premier octet. C'est la vraie réponse au problème — elle
distingue le muet du lent — mais elle demande de réécrire les quatre
fournisseurs et leur lecture de réponse, pour un gain nul tant que le premier
modèle répond en sept secondes.

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

## D6 — La pastille « IA » remplace la phrase (2026-11-20)

« Composée par l'IA, non vérifiée » occupait une ligne entière sous une ligne
de méta qui disait déjà « Composition ». Le propriétaire a demandé une
pastille. La carte porte donc un `IA` discret à côté du badge de couverture ;
la phrase entière reste le **nom accessible** de la pastille et le
sous-titre de la fiche détaillée. L'aveu de D5 n'est pas perdu, il est
resserré — et une recette web dont la page a été lue continue de nommer son
site, sans pastille.

### D6 bis — La pastille se lit en entier, hors écran

Première version : `aria-label` sur le `<span>` de la pastille. C'est faux. Les
attributs ARIA de nom ne s'appliquent pas aux éléments génériques : un `<span>`
sans rôle ne porte pas de nom accessible, et la mention aurait disparu pour un
lecteur d'écran au lieu d'être resserrée. La pastille contient donc la phrase
entière dans un texte `sr-only` et un « IA » en `aria-hidden` : vu court, lu
complet.

Les parcours bout en bout comptent la pastille par `data-testid`, et non son
texte, qui est désormais porté par deux éléments imbriqués.

**Ces parcours n'avaient pas été corrigés avec le reste.** Ils vérifiaient la
phrase exacte, ils ne tournent que sur `main` après fusion (le propriétaire n'a
pas de moteur de conteneurs sur son poste), et la 0.43.1 est donc partie avec
quatre d'entre eux cassés. La règle à en tirer : **tout changement de libellé
visible se cherche aussi dans `e2e/`**, où aucune vérification locale ne le
rattrapera.

## D7 — Un nombre sans unité vaut des pièces

Relevé en service sur la première fournée de la 0.43.2 : **quatre compositions
sur quatre refusées** à l'entrée dans « Mes recettes », `Une quantité exige une
unité`, sur les ingrédients 6 et 7.

Deux schémas se contredisaient sans que personne les ait comparés. Celui des
suggestions accepte une quantité sans unité depuis le 2026-11-14 — « 2 œufs »
est clair, et le perdre appauvrissait la recette. Celui des recettes
l'interdit, et cette règle est juste là où elle s'applique : son formulaire
fait toujours choisir dans une liste.

La contradiction dormait tant que le modèle écrivait trois ingrédients tirés du
stock scanné, c'est-à-dire des grammes et des millilitres. **D2 l'a réveillée**
en autorisant le placard de base, dont tout se compte à l'unité : « 2 gousses
d'ail », « 1 oignon », « 3 œufs ». Les ingrédients 6 et 7 sont précisément ceux
que la nouvelle consigne a fait apparaître.

`recipeIngredientFromModel` (`packages/shared`) accorde les deux : un nombre nu
désigne des objets entiers, ce qui est la définition de `PIECE`, déjà l'unité
des produits comptés à la pièce. On la pose plutôt que de jeter la quantité —
« Oignon » sans son « 1 » n'aide personne à cuisiner — et plutôt que de
relâcher la règle du formulaire.

Les recettes déjà refusées ne sont pas perdues : elles sont au réservoir et
**Réglages › Reconnaissance › rattrapage** les reprendra.

## D8 — Le modèle convertit les cuillères, l'application ne les apprend pas (2026-11-21)

> « il me faut l'équivalent en quantité pour les cuillères ou autre mesure, je
> dois toujours avoir les informations en ml, g (calculer automatiquement en
> fonction du nb de personne que je choisis »

Le jeu d'unités de la section 15 est fermé et ne contient ni cuillère, ni
pincée, ni verre. Le modèle, lui, pense en cuillères : n'ayant pas d'unité où
la ranger, il laissait la quantité vide — « Huile d'olive », sans un chiffre.
Le champ **Parts** de la fiche recette (EF-26) n'avait alors plus rien à
mettre à l'échelle, puisqu'une quantité absente ne se multiplie pas. Les deux
moitiés de la demande sont donc un seul défaut.

**Deux issues possibles**, et une seule a été retenue :

- *Ajouter des unités* `TABLESPOON`, `TEASPOON`, `PINCH` : migration Prisma,
  familles de conversion nouvelles (une cuillère est un volume pour l'huile,
  une masse pour la farine — donc pas une famille, mais une dépendance à
  l'ingrédient), et un stock qui n'en a aucun usage. Écartée.
- *Demander la conversion au modèle*, avec ses équivalences écrites. C'est le
  seul maillon de la chaîne qui sache qu'une cuillère à soupe d'huile fait
  15 ml et qu'une gousse d'ail est une pièce. Retenue : `MEASUREMENT_RULE`,
  une constante partagée par les deux consignes système (écrite et parlée) et
  par la réécriture d'une page web conservée.

**Les huit unités restent ouvertes**, pas seulement le gramme et le
millilitre (question du propriétaire, même jour) : kilo, litre, paquet, boîte
et sachet servent aussi en cuisine, et la consigne demande celle qui se lit le
mieux — 1 kg de pommes de terre, pas 1000 g. Ce qui est interdit, c'est la
mesure que l'application ne sait pas ranger, pas la grande unité.

La règle vaut aussi pour les **étapes** et interdit la quantité dans le
libellé (« Huile d'olive (2 c. à soupe) » contournait tout). Elle ne laisse
une quantité vide que pour ce qui se dose vraiment au goût.

**Le nombre de parts n'a pas bougé** : il est déjà sur la fiche recette, et
c'est le seul endroit où il a un sens — le réservoir est partagé, une
suggestion mise à l'échelle pour six y resterait pour six. La fiche recalcule
à l'affichage, par `servingsRatio` et `scaleIngredients`
(`packages/shared/src/rules/servings.ts`), inchangés.

**Les recettes déjà au réservoir gardent leurs trous** : une consigne ne
réécrit pas ce qui est déjà écrit. Seules les fournées suivantes en profitent.

## Ce qui n'est pas garanti

Rien ici ne prouve que les recettes seront bonnes : la consigne et le modèle
rendent le résultat probable, pas certain. Le seul contrôle automatique
possible porte sur le texte envoyé — c'est ce que font les tests ajoutés à
`gemini-suggestion.provider.spec.ts`. Le reste se juge dans l'assiette.
