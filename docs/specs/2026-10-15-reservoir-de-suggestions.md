# Réservoir permanent de suggestions, et vérification des recettes web

**Date** : 2026-10-15
**Demande de Franck** : « concernant les suggestions, elles sont en cache ou
recherchées à chaque fois ? L'idée est d'avoir la recette en mémoire une fois
qu'elle a été trouvée et pas redemander à Gemini à chaque fois. » ; « une fois
en mémoire, elle va regarder en fonction des aliments dispo et affiche le % de
réalisation possible (par ex. 3 ingrédients sur 4). Mais il faut la garder en
mémoire. » ; « pas d'âge max, tu logges tout, ça me fera une belle base de
données. Par contre que Gemini n'hallucine pas sur une recette, il faut qu'elle
existe. »

**Exigences touchées** : EF-25, EF-26 (section 12 du cahier des charges).

## Ce qui existe aujourd'hui

| Élément | Durée de vie actuelle |
| --- | --- |
| Le taux de couverture (« 3 ingrédients sur 4 ») | jamais stocké, recalculé contre le stock à chaque affichage |
| Une suggestion conservée | permanente, devient une `Recipe` du foyer |
| La fournée de suggestions | `SuggestionBatch`, TTL 24 h, clé = identifiants des ingrédients de départ + orientation + version du prompt |

La partie « % recalculé contre le stock » répond déjà à la deuxième phrase de
la demande : rien à changer de ce côté, c'est `toSuggestionDtos(recipes,
snapshot)` qui le fait à chaque appel.

Le défaut est dans la troisième ligne. La clé du cache contient les
identifiants des produits piochés dans le stock : un article consommé change
la pioche, donc la signature, donc déclenche un nouvel appel à Gemini pour des
recettes souvent proches de celles déjà rapportées. Et au bout de 24 heures
tout est de toute façon jeté.

## Décisions

**D1 — Le réservoir est permanent, sans âge maximum.** Décision explicite de
Franck : « pas d'âge max, tu logges tout ». Une recette rapportée par Gemini
entre au réservoir et y reste. Le volume est négligeable : douze recettes par
fournée, quelques fournées par jour au pire, du JSON de quelques kilo-octets.

**D2 — Une recette par ligne, pas une fournée.** Nouvelle table
`SuggestionPoolRecipe`. `SuggestionBatch` est conservée, non plus comme cache
mais comme trace des orientations déjà demandées (voir D11, qui amende ce rôle :
le journal brut par appel, c'est `RecognitionLog.rawResult` qui le tient) ; le
réservoir est la vue dédoublonnée et exploitable par-dessus. Dédoublonner à
l'intérieur de charges utiles de fournées serait impossible sans la table.

**D3 — Dédoublonnage par `suggestionIdentity`, la règle qui existe déjà.**
`packages/shared/src/rules/suggestion-identity.ts` calcule déjà l'identité
stable d'une suggestion (titre normalisé + URL source, hachage FNV-1a) et sert
déjà à retrouver une recette à conserver. C'est la clé unique du réservoir :
inventer une seconde notion d'identité à côté de celle-ci serait une fabrique à
bugs. Une recette déjà connue ne crée pas de ligne, sa date de dernière
apparition est mise à jour.

Conséquence connue et acceptée : deux compositions au même titre (« Riz
sauté ») partagent une identité et n'occupent qu'une ligne. Dans une fournée,
`suggestionIdentities` les désambiguïsait par un suffixe ; dans un réservoir
permanent, la seconde est simplement un doublon — ce qui est le comportement
voulu.

**D4 — Une recette `web` n'entre au réservoir que si sa page existe.** Réponse
à « que Gemini n'hallucine pas ». À l'ingestion, chaque recette de provenance
`web` passe par `RecipePageFetcher.fetchContent(sourceUrl)`, déjà écrit pour
la conservation d'une suggestion : HTTPS seul, hôtes privés et locaux refusés,
délai borné, redirections revalidées. Page injoignable, refusée ou vide → la
recette est **jetée avant stockage**, jamais affichée. Coût : une requête HTTP
par recette web, zéro jeton Gemini.

**D5 — Les compositions restent, marquées.** Choix de Franck entre trois
options (2026-10-15). Une recette de provenance `ai` n'a pas d'URL à vérifier :
elle est composée par le modèle, par construction. Elle entre au réservoir avec
`verifiedAt` à `null` et s'affiche avec une mention sans ambiguïté — « Composée
par l'IA, non vérifiée » au lieu de l'actuel « Proposée par l'IA » — et passe
**après** les recettes web vérifiées dans l'ordre d'affichage.

Contexte qui rend D5 nécessaire : la recherche web de Gemini exige la
facturation activée sur le projet Google Cloud, ce qui n'est pas fait, et le
réglage « Recherche web des recettes » est coupé. Aujourd'hui **toutes** les
suggestions sont donc des compositions. Interdire les compositions viderait
l'écran ; les marquer dit la vérité sans casser l'usage.

**D6 — Gemini n'est appelé que si le réservoir ne suffit pas.** À chaque
affichage, le service lit le réservoir, filtre sur l'orientation demandée
(type de plat, cuisine, durée, facilité), calcule la couverture contre le stock
du moment et trie. Il n'appelle le modèle que dans deux cas :

1. le réservoir rend moins de `SUGGESTION_POOL_FLOOR` recettes pour cette
   orientation (valeur retenue : 6, la moitié d'une fournée) ;
2. la demande porte `refresh: true` — le bouton de relance explicite.

**D7 — Le tri du réservoir.** Recettes web vérifiées d'abord, compositions
ensuite ; à l'intérieur de chaque groupe, par couverture décroissante, puis
par date de première apparition décroissante. Une recette déjà conservée dans
« Mes recettes » ne réapparaît pas.

**D8 — Le cache de fournée à 24 h disparaît.** `readFreshBatch` et
`CACHE_TTL_MS` deviennent sans objet : le réservoir est un cache permanent et
plus fin. `SuggestionBatch` garde son rôle de journal, sa signature reste
unique pour l'écriture, mais plus personne ne la lit pour servir une réponse.
`readLatestBatch` (repli quand le quota est dépassé) est remplacé par une
lecture du réservoir, qui n'est jamais vide une fois amorcé.

**D9 — `keep` cherche dans le réservoir, par identité.** `suggestionId` est
déjà l'identité calculée par `suggestionIdentity` : c'est la clé unique du
réservoir, donc la conservation n'a plus besoin de relire une fournée, de la
revalider et d'y chercher un rang. `batchId` reste dans le DTO (il désigne la
livraison, utile au journal) mais ne sert plus à retrouver la recette.

**D10 — La page vérifiée est lue une seule fois, et son contenu est gardé.**
Demande de Franck : « tu peux récupérer les infos de la page avec la recette,
pour la garder et ne plus la rappeler par la suite. » `fetchContent` rend déjà,
en un seul GET, les données structurées `schema.org/Recipe` quand la page en
porte et le texte nettoyé (plafonné à 8 000 caractères) sinon. Les deux sont
écrits dans la ligne du réservoir au moment de la vérification.

Conséquence sur la conservation d'une suggestion web, qui coûtait jusqu'ici une
requête HTTP **et** un appel Gemini de réécriture :

| Ce que porte la ligne | Conserver la recette coûte |
| --- | --- |
| Données structurées | rien du tout : ni réseau, ni modèle |
| Texte seul | un appel de réécriture, sans requête réseau |
| Composition `ai` | rien, inchangé |

Le lecteur de page n'est donc plus appelé qu'une seule fois par recette, à
l'entrée du réservoir — **jamais à la conservation, et jamais plus ensuite**.
Confirmé par Franck : « pas la peine de la recontacter plus tard, c'est un
one-shot et ensuite tu la gardes en mémoire dans l'application/serveur. » Aucune
revérification périodique n'est prévue, ni maintenant ni plus tard : une fois
la ligne écrite, le site n'est plus jamais sollicité.

**D11 — La signature de fournée perd ses graines (amendement du 2026-10-15,
après revue de la tâche 4).** Un filtre étroit — « ≤ 15 min » — laisse presque
toujours le réservoir sous le plancher de D6, donc rappelle le modèle à chaque
visite : exactement la dépense que ce lot supprime, réintroduite par une autre
porte. La parade retenue d'abord, « ne pas rappeler si une fournée de même
signature date de moins de 24 h », ne tenait pas : `computeSignature` contient
les identifiants des graines, donc le stock, donc précisément la volatilité que
cette spec dénonce. Un foyer qui scanne puis ouvre Suggestions repaierait quand
même.

`computeSignature` ne prend donc plus les graines : la signature devient une clé
d'orientation pure, et « cette question a-t-elle déjà été posée dans les 24 h ? »
se lit sur la `SuggestionBatch` de même signature, sans migration ni colonne
nouvelle. `SUGGESTION_SIGNATURE_VERSION` passe à `v4`.

Rien n'est perdu au journal : `RecognitionLog.rawResult` garde déjà la réponse
complète **par appel**, ce que `SuggestionBatch` ne faisait pas — son `payload`
était de toute façon écrasé à chaque réécriture de la même signature. D2 est
amendée en conséquence : `SuggestionBatch` n'est plus le journal brut, c'est la
trace « cette orientation a déjà été demandée, et quand ».

La dépense était déjà bornée deux fois (`RECIPE_SUGGESTION_DAILY_QUOTA` à 20 par
jour, `VISION_MONTHLY_CAP_CENTS` à 5 €). Le dommage réel n'était donc pas une
dépense illimitée, mais un filtre étroit qui mange le plafond mensuel **partagé
avec le scan photo** et finit par affamer celui-ci.

## Limites assumées

- Une page qui existe aujourd'hui peut disparaître demain, et rien ne le
  détectera (D10 : un seul contact, définitif). Le coût réel est faible : le
  contenu utile est déjà recopié dans le réservoir, donc un lien mort ne fait
  plus perdre que le lien.
- `fetchContent` suit `schema.org/Recipe` quand il existe et retombe sur le
  texte nettoyé sinon. Une page qui répond mais ne parle pas de cuisine passe
  donc la vérification. Vérifier le *contenu* demanderait un appel au modèle
  par recette, soit exactement la dépense que cette spec cherche à supprimer.
- La vérification ajoute une requête HTTP par recette web d'une fournée neuve,
  en parallèle, sous le même plafond de délai. Une fournée est donc rendue un
  peu plus tard qu'avant — seulement lorsqu'elle est neuve, ce qui devient rare,
  et ce temps est repris à la conservation, qui ne fait plus de réseau du tout.
- Le contenu de la page est figé au jour de la vérification : une recette
  corrigée par son auteur après coup ne sera pas suivie. C'est le prix de ne
  plus jamais rappeler le site, et c'est ce que la demande réclame.
