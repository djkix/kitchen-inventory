# Kitchen Inventory — inventaire alimentaire maison

Application web auto-hébergée qui inventorie les produits comestibles de la
maison par scan depuis le téléphone, suit les dates de péremption et suggère
des recettes à partir de ce qui est réellement en stock, trouvées sur le web
ou composées par une IA.

## Le principe

On se place devant un placard, on choisit l'emplacement une fois, puis on
enchaîne les scans : la caméra reste ouverte, chaque code-barres reconnu ajoute
un article avec quantité 1 et une annulation possible pendant cinq secondes.
Quand un produit n'a pas de code-barres lisible ou n'est connu d'aucune base,
une photo suffit : un modèle de vision propose une fiche (nom français, nom
d'origine translittéré, marque, catégorie, date de péremption lue sur
l'emballage), que l'on valide ou corrige. La correction est mémorisée : au
second scan, plus aucune IA n'est appelée.

La reconnaissance suit une cascade, du moins cher au plus coûteux :

1. décodage du code-barres dans le navigateur, sans réseau ;
2. cache local des produits déjà rencontrés ;
3. [Open Food Facts](https://world.openfoodfacts.org), base publique sans clé ;
4. modèle de vision (Google Gemini ; le modèle se choisit dans Réglages),
   derrière une interface qui permet de changer de fournisseur sans toucher
   au reste.

Le tout tourne à la maison : trois conteneurs, PostgreSQL, un dossier de
photos. Seules les photos d'articles envoyées au fournisseur de vision quittent
le réseau, jamais l'inventaire.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Première connexion](#première-connexion)
- [Accès de secours](#accès-de-secours)
- [Mise à jour](#mise-à-jour)
- [Sauvegarde et restauration](#sauvegarde-et-restauration)
- [Configuration](#configuration)
- [Intégrations](#intégrations)
- [Développement](#développement)
- [Stack technique](#stack-technique)
- [Derniers changements](#derniers-changements)
- [Licence](#licence)

## Fonctionnalités

**Scan en rafale.** Code-barres EAN-8, EAN-13, UPC et QR décodés dans le
navigateur (`BarcodeDetector` natif, repli ZXing en WebAssembly). Retour
haptique et sonore, emplacement courant collant, annulation cinq secondes.
Chaque lecture ouvre un tiroir de validation : le produit reconnu est affiché
avec sa photo et sa marque, la quantité est ajustable au pas de son unité
(une pièce, 100 g, 0,1 l), et rien n'entre en stock avant confirmation. La
date de péremption peut s'y saisir dans le même geste, par un raccourci
(« +3 j », « +1 sem », « +1 mois ») ou en date libre avec le choix DLC/DDM —
mais rien n'est obligatoire : valider sans y toucher reste le même bouton,
au même endroit. Une date oubliée se rattrape ensuite depuis le bandeau
« Ajouté : … », sans quitter la caméra. Un article déjà validé n'est relu
que lorsqu'il a quitté le champ de la caméra.

**Reconnaissance photo.** La prise de vue passe par l'appareil photo du
téléphone, pour profiter de l'autofocus, du flash et de la stabilisation : une
étiquette dorée ou gravée dans un placard peu éclairé se lit nettement mieux
qu'avec une capture du flux vidéo. Étiquettes japonaises, coréennes, chinoises
et thaïes lues et traduites ; le nom d'origine est conservé avec ses
idéogrammes. Entre 50 et 80 % de confiance, la fiche est proposée avec des
champs « à vérifier » ; sous 50 %, l'application demande une nouvelle photo
plutôt que d'inventer. Deux garde-fous de dépense : un quota d'appels par jour
et un plafond mensuel en euros, tous deux visibles dans les réglages. La photo
reste disponible même quand la caméra du navigateur est refusée, cas d'un accès
sans HTTPS où le scan de code-barres, lui, est impossible.

**Stock et péremption.** Un produit (le référentiel) se distingue d'un lot (un
exemplaire physique avec sa date et son emplacement). DLC dépassée en rouge,
DDM dépassée en orange, date estimée signalée par une icône pour les
périssables non emballés. À l'ouverture d'un produit, la date effective tient
compte de la durée après ouverture de sa catégorie. Vue « périme bientôt »
avec seuil réglable.

**Mouvements autoritaires.** La quantité d'un lot est la somme de ses
mouvements (entrée, consommation, ajustement, perte) ; chaque écriture porte un
identifiant d'opération, donc rejouer une requête ne compte jamais deux fois.
Une consommation qui dépasse le stock est ramenée au disponible, avec un
message explicite.

**Emplacements imbriqués** à profondeur libre : pièce, meuble, étagère, bac,
autant de niveaux que voulu. La suppression est refusée tant qu'il reste du
stock, avec la proposition de le déplacer vers le parent.

**Recherche tolérante** aux fautes, aux synonymes et aux accents : « nouilles »
trouve « ramen », « tomat » trouve « Tomates pelées », « creme » trouve
« Crème fraîche » même saisi sans accent depuis un téléphone, la recherche
porte aussi sur le nom d'origine et la marque.

**Multi-utilisateur** sur un inventaire partagé, comptes locaux, sessions
révocables, verrouillage après échecs répétés, jeton de service en lecture
seule pour Home Assistant. Export CSV et JSON.

**Module recettes.** L'onglet **Recettes** de la barre du bas ouvre toujours
l'écran **Suggestions**, la porte d'entrée du module ; **Mes recettes** reste
à une tape, par la bascule en tête (visible sans défilement, le volet actif
se distingue par la bordure, le fond et le poids du texte, et un lecteur
d'écran l'annonce). Le dernier volet consulté n'est plus mémorisé : l'onglet
ouvre toujours Suggestions, jamais un volet où une visite précédente aurait
laissé l'application.

À l'arrivée sur **Suggestions**, une question bloquante demande le type de
plat recherché — entrée, plat, dessert, accompagnement, apéritif,
petit-déjeuner, boisson — avant d'afficher quoi que ce soit d'autre : ni
liste, ni filtres, ni squelette de chargement. La réponse oriente la
recherche initiale : l'application compose un point de départ depuis le
stock réel (huit ingrédients au plus, les plus structurants, trois places
tournant d'un jour à l'autre pour renouveler les idées), interroge Google
Gemini en lui demandant de ne proposer que ce type de plat, et affiche une
douzaine de recettes — certaines trouvées sur de vrais sites,
d'autres composées par le modèle, chaque carte disant laquelle : le nom du
site pour une recette dont **la page a réellement été lue**, « composée par
l'IA, non vérifiée » sinon. Une recette annoncée comme trouvée sur le web
dont la page ne répond pas est écartée avant d'atteindre l'écran : le modèle
ne peut pas faire passer un lien inventé pour une recette qui existe.

Une fois la fournée affichée, quatre sélecteurs natifs tiennent sur deux
lignes de deux (type de plat et cuisine, puis durée et facilité) — plus
compacts que les quatre rangées de pastilles d'origine, qui occupaient la
moitié d'un écran de téléphone. Les quatre relancent une vraie recherche
ciblée auprès du modèle à chaque changement, y compris le **type de plat**
(asiatique, méditerranéenne…), désormais au même titre que la **cuisine**,
la **durée** (≤ 15, ≤ 30, ≤ 60 min) et la **facilité** : la fournée
demandée au modèle ne contenant déjà qu'un seul type, un simple filtre
local sur ce même type n'aurait plus rien eu à faire. Le sélecteur de type
reflète dès l'arrivée celui répondu à la question, et repartir d'un autre
type se fait directement depuis la barre, sans repasser par la question.
**Vos ingrédients à vous, au-dessus des filtres.** Un champ de saisie, vide
par défaut, permet de dicter ce que la recette doit utiliser : « pommes de
terre, merguez ». Chaque terme validé — par Entrée ou par une virgule —
devient une **pastille** visible, portant une croix pour la retirer : on voit
donc ce qui part, au lieu de découvrir après l'appel au modèle que « poulet
tomate » tapé sans virgule avait été compris comme un seul ingrédient de ce
nom. Le retour arrière sur un champ vide retire la dernière pastille, et un
terme tapé sans être validé part quand même avec la recherche. Dès les
premières lettres, les **produits de votre catalogue** sont proposés en
dessous (« pou » → « Poulet fermier ») : un terme choisi dans la liste porte
exactement un libellé connu, donc le rapprochement aux recettes ne dépend
plus de l'orthographe du jour. La liste propose, elle n'impose jamais — « reste
de merguez » n'est dans aucun catalogue et reste parfaitement saisissable.
Cinq ingrédients au plus, trente caractères chacun : l'écran refuse le terme
de trop en disant pourquoi, sans rien envoyer. Ce qui est tapé est **imposé** : seules des recettes
utilisant tous ces éléments sont proposées — l'objet est d'écouler un reste,
pas de recevoir des idées vaguement proches. Du texte libre, et non une
sélection dans l'inventaire : un reste de merguez n'a pas de code-barres, il
est né du repas d'hier, et c'est précisément ce que le stock ne sait pas dire.
Le stock continue d'être pris en compte, en complément. L'application cherche
d'abord dans le réservoir les recettes qui portent ces ingrédients et
n'interroge le modèle que si elle en trouve moins de six : retaper la même
demande ne coûte rien, et le singulier comme le pluriel y mènent à la même
recette (« pomme de terre » trouve « Pommes de terre nouvelles »). Un
ingrédient que vous venez de déclarer n'est jamais annoncé comme manquant —
la fiche de la recette l'affiche « Déclaré » et non « Manquant » ; le taux de
couverture, lui, reste calculé sur le stock réel, si bien qu'une recette peut afficher « 3 sur 4 » sans lister
aucun manquant — un chiffre prudent plutôt qu'un chiffre inventé. Une
combinaison trop rare peut ne rien rendre : l'écran le dit alors, au lieu
d'afficher une liste vide et muette. Le champ vide ne change rien au
comportement habituel.

**Les recettes trouvées ne s'effacent plus.** Chaque recette rapportée par le
modèle entre dans un réservoir permanent, dédoublonnée par son titre et son
lien : elle y reste sans limite d'âge. À chaque visite, l'application lit ce
réservoir, recalcule la couverture contre le stock du moment
(« 3 ingrédients sur 4 ») et classe les recettes web vérifiées avant les
compositions. L'écran en affiche une douzaine, les mieux classées, et le bouton
« Charger plus » donne accès aux suivantes : le réservoir peut en contenir
des centaines, la première page reste de la même taille qu'au premier jour. Tout ce que le modèle rapporte entre au réservoir, y
compris ce qui ne tient pas sur la page — rien de ce qui est payé n'est
jeté. Le modèle n'est rappelé que dans deux cas : le réservoir
rend moins de six recettes pour l'orientation demandée, ou vous appuyez
vous-même sur « Chercher de nouvelles recettes ». Consommer un article du
stock ne déclenche plus de nouvelle recherche payante.

**Tout le réservoir se parcourt.** Sous la liste, un bouton
« Charger plus (12 sur 37) » — le même geste et la même formulation que
« Mes recettes » — allonge la page de douze recettes à chaque appui, jusqu'à
soixante. Il disparaît dès que tout ce que le réservoir connaît pour
l'orientation est affiché. Charger plus ne relit que le réservoir : aucun
appel au modèle n'en découle, et donc aucune dépense. Au-delà de soixante
recettes, ce sont les orientations (cuisine, durée, facilité) qui servent à
retrouver ce que l'on cherche, pas une page plus longue.

**Une relance montre ce qu'elle rapporte.** Les recettes que l'appel vient
de ramener passent en tête de la liste, devant les anciennes même mieux
couvertes : sans cela, une nouveauté se rangeait derrière les douze déjà
affichées et l'écran ne bougeait pas. L'ordre habituel (web vérifiées
d'abord, puis par couverture) reprend de lui-même au geste suivant ; rien
n'est mémorisé.

**Les propositions sont diversifiées.** Le modèle doit rendre des plats
nettement différents les uns des autres — jamais deux variantes de la même
recette — en variant l'ingrédient principal, la technique de cuisson et la
base. Les titres déjà au réservoir pour l'orientation demandée (les
quarante plus récents) lui sont cités avec consigne de ne pas les
reproposer. L'orientation demandée reste impérative : diversifier, c'est
varier à l'intérieur du filtre, pas l'ignorer.

Quand une page est lue, son contenu est recopié en base **une fois pour
toutes** : le site n'est jamais recontacté, ni pour revérifier, ni au moment
où vous conservez la recette. En contrepartie, une recette dont la page
disparaît ensuite reste utilisable, mais son lien meurt — et une recette
corrigée par son auteur après coup ne sera pas suivie.

Une même orientation n'est pas redemandée au modèle plus d'une fois par
24 heures. Si elle ne rend rien, l'écran le dit, annonce à partir de quand
une nouvelle recherche partira d'elle-même, et propose le bouton de relance :
jamais un écran vide et muet.
Les épices, le sel et le poivre ne sont jamais retenus comme point de départ
(l'huile et le vinaigre le restent) ; les dates de péremption n'interviennent
à aucun titre dans les suggestions.

Le titre d'une recette tient sur deux lignes au plus, sans jamais être
tronqué sur une seule — aussi bien sur une carte de suggestion que sur une
carte de « Mes recettes ».

**Le geste « page précédente » ferme le tiroir ouvert**, au lieu de quitter
l'écran : sur un téléphone, un glissement vers la gauche depuis le tiroir d'une
suggestion basculait jusque-là sur l'écran précédemment consulté. Tous les
tiroirs de l'application se referment ainsi, et un tiroir fermé autrement
(croix, Échap, Annuler) ne laisse pas de retour « fantôme » derrière lui.

La fiche d'une suggestion montre les ingrédients et ce qui manque (chacun avec
sa photo, s'il est rapproché d'un produit connu, et la pastille colorée de
l'emplacement de son lot le plus proche de péremption quand il est en stock).
Les étapes d'une recette **composée par l'IA** y sont déjà visibles, puisque
« Je fais cette recette » n'a alors rien de plus à aller chercher ; une recette
**trouvée sur le web**, elle, n'affiche encore aucune étape à ce stade — sa
page n'est lue qu'à la conservation, et la fiche l'annonce honnêtement plutôt
que d'en inventer. Le tiroir porte **deux boutons** : à gauche **« Je fais
cette recette »**, l'action, qui conserve et mène directement à la fiche (où se
règle le nombre de parts) ; à droite **« Annuler »**, qui ferme et revient aux
suggestions sans rien enregistrer, et reste indisponible tant qu'une
conservation est en cours. « Je fais cette recette » — un seul geste, pas une
consultation puis une conservation séparée —
récupère la page de la recette
(HTTPS uniquement, 5 secondes maximum), lit ses données structurées
`schema.org/Recipe` quand elles existent, et la fait **réécrire par Gemini au
format propre à l'application** — l'application n'envoie jamais vers le site
d'origine, pour une recette composée les étapes déjà produites sont reprises
telles quelles. La difficulté est alors recalculée par le barème du foyer
(elle peut changer d'un cran par rapport à celle affichée avant conservation).
La recette entre dans **Mes recettes**, qui reprend le socle du foyer :
cuisson, historique, notation par membre.

Gemini rend une durée de préparation et une durée de cuisson séparées (`null`
quand la recette n'en a pas, comme une salade, ou que le modèle ne les
distingue pas — jamais un zéro qui se lirait « cuisson : 0 minute ») en plus
de la durée totale affichée sur les cartes, et chaque étape de cuisson doit
préciser température du four, intensité du feu et durée : une étape qui ne le
ferait pas est jugée inexploitable. Les deux durées, une fois la recette
conservée, s'affichent sur la fiche recette (à côté du temps actif et du
repos) et sur la fiche d'une suggestion.

**Favoris et note directe.** Une étoile à cocher (pleine contre vide, jamais la
seule couleur, annoncée par `aria-pressed`) marque une recette comme favorite —
une seule liste partagée par le foyer, pas de favori par personne : qui la
retire la retire pour tout le monde. Elle se coche aussi bien sur la fiche que
sur chaque carte de « Mes recettes », indépendamment de la note : on peut
adorer une recette compliquée sans vouloir la refaire chaque semaine, et
marquer une recette banale qu'on fait tout le temps. Une **note du foyer**
(partagée, pas une note par personne) existe en base et sert au tri par
défaut ; elle se lit sur chaque carte de « Mes recettes », mais **ne s'affiche
plus sur la fiche**, où ses cinq étoiles prenaient trop de place sur un
téléphone. La notation d'une réalisation, elle, est intacte : nominative, par
membre, depuis l'historique de la fiche. **Règle de préséance**, partout où une
note s'affiche (carte, fiche, tri par note) : la note directe prime quand elle
existe ; sinon la moyenne des réalisations prend le relais ; si ni l'une ni
l'autre n'existe, rien ne s'affiche — jamais deux chiffres concurrents sous les
yeux. La note par réalisation continue d'exister telle quelle, à part : c'est
l'avis sur un repas réellement cuisiné, par membre du foyer, conservé dans
l'historique.

**Mes recettes**, classées **par défaut selon la note** (les mieux notées en
tête, note directe et moyenne des réalisations classées ensemble par la même
règle de préséance, puis les non notées, titre à l'alphabet en dernier
recours) — le stock n'intervient pas dans ce tri par défaut. La recherche par
titre est tolérante aux accents et à la casse, comme la recherche produits
(« crepes » trouve « Crêpes »). Le tri reste mémorisé par utilisateur avec les
filtres, mais **son sélecteur n'est plus affiché** : la liste commence en haut
de l'écran, sur le tri que le foyer a mémorisé. Les filtres, eux, vivent
derrière un **bouton « Filtres »** posé à droite de la recherche, portant le
nombre de filtres actifs (« Filtres (2 actifs) ») et ouvrant un **panneau par
le bas** : rien n'a été retiré, c'est la place permanente qui disparaît. On y
retrouve les six sélecteurs (type de plat, cuisine, durée, facilité, régime,
note minimale), une seule valeur active par facette, et les cinq bascules
(valeurs sûres, réalisables maintenant, déjà faites, **favoris**, archivées).

**Effacer une recette de la liste.** Un glissement vers la gauche sur une carte
découvre une action rouge ; la toucher demande confirmation, et la recette est
alors **archivée** — elle quitte « Mes recettes », garde son historique et ses
notes, et la bascule « Archivées » la retrouve entière. Rien n'est supprimé.
Le glissement seul n'efface jamais : il se déclenche par accident en faisant
défiler au pouce. Et comme un glissement n'existe ni au clavier, ni au lecteur
d'écran, ni à la souris, la même action se découvre aussi au **focus** (une
tabulation) et au **survol**. Limite connue : rien à l'écran n'indique que le
glissement existe, comme pour tous les glissements de liste.

Chaque carte affiche son
**taux de couverture et son groupe** (prête, presque, incomplète) calculés
depuis le stock réel, même si ce groupe ne change plus l'ordre ni la visibilité
de la liste. Chaque carte affiche aussi la note retenue par la règle de
préséance ci-dessus et le nombre de réalisations (« Faite N fois · il y a X
jours · ★ Y », ou « Jamais faite » sans note ni compteur, ou encore « Jamais
faite · ★ Y » pour une recette jamais cuisinée mais déjà notée directement).

Il n'y a **plus de création manuelle** : le bouton d'ajout a disparu, et le
formulaire ne sert plus qu'à **modifier** une recette déjà conservée (titre,
cuisine, type de plat, régimes, portions, temps, étapes, ingrédients). Une
recette de famille qu'on ne trouve pas sur le web n'a, de ce fait, plus sa
place dans l'application.

La fiche d'une recette conservée affiche chaque ingrédient avec, quand elle
existe, la photo du produit rapproché et une pastille colorée (par icône
autant que par teinte — la couleur ne porte jamais seule l'information)
désignant l'emplacement de son lot le plus proche de péremption : ambiant,
frais ou congelé.

En tête de fiche, la **durée totale** et la **difficulté** sont des blocs
colorés, sur deux échelles distinctes (du céladon de l'accent à l'orange
d'avertissement, selon que c'est court et facile ou long et exigeant) : la
couleur ne porte jamais l'information seule, le texte (« 30 min », « Facile »)
reste écrit en toutes lettres.

Le **nombre de parts** est rangé dans le même bloc que les durées
(préparation, cuisson, temps actif, repos) — « pour combien, et combien de
temps » est une seule lecture. Il reste ajustable (champ
numérique, initialisé aux portions de la recette) : le modifier recalcule
aussitôt la quantité de chaque ligne et son état face au stock (une ligne
tout juste suffisante à quatre parts peut devenir insuffisante à huit — voir
la limite connue ci-dessous). C'est
le **même nombre**, du premier coup d'œil jusqu'à la cuisson — jamais un
second champ à tenir à côté : il préremplit « Portions réalisées » dans le
tiroir de cuisson, et c'est aussi lui que reprend « J'ai fait cette
recette » pour une réalisation sans décrément.

Depuis la fiche recette, « Cuisiner » ouvre un tiroir de cuisson : portions
réalisées ajustables (préremplies par le nombre de parts choisi sur la fiche),
chaque ligne décrémentable cochée par défaut, choix du
produit retenu (celui qui périme le plus tôt, modifiable) pour toute ligne
substituable ou visant directement une catégorie, et note facultative à cinq
étoiles. La mise à l'échelle des quantités affichées (fiche comme tiroir) suit
une seule règle partagée, exclut du
choix les lots dont la date de péremption est dépassée (comme le calcul de
couverture) et suit la fusion d'un produit s'il en a rejoint un autre
depuis. Une ligne décochée ou sans quantité chiffrée (hors inventaire)
n'émet aucun mouvement ; une ligne chiffrée qui ne résout aucun produit (cas
catégorie sans choix) est signalée plutôt qu'ignorée en silence. Si le stock
ne suffit pas, la quantité retirée est ramenée au disponible plutôt que de
faire échouer la cuisson, et le tiroir le signale en clair ; cuisiner une
recette archivée est refusé. « J'ai fait cette recette » reste disponible
pour une réalisation sans aucun décrément. La
fiche recette porte un bloc Historique (moyenne, nombre de réalisations,
tendance, puis chaque réalisation avec qui a cuisiné et la note de chaque
membre du foyer) : chaque membre note une réalisation de 1 à 5 étoiles, une
fois, modifiable pendant les **sept jours** qui suivent, puis en lecture
seule — y compris une réalisation passée, directement depuis son bouton
« Noter » dans l'historique, sans repasser par une cuisson. Sur l'écran Mes
recettes, un bandeau invite à noter la dernière
réalisation récente encore sans note (pas celle d'une recette depuis
archivée) ; il se ferme pour la journée et se rouvre le lendemain tant qu'il
reste quelque chose à noter. Une recette jamais cuisinée ne montre plus un
historique vide sans explication : la fiche dit qu'aucune réalisation n'est
enregistrée, et que la note directe, elle, reste possible dès maintenant.

Une recette jamais cuisinée se supprime réellement ; une recette déjà
réalisée ne se supprime pas (la suppression échoue avec le nombre de
réalisations) mais s'archive, avec restauration possible — l'historique et
les notes sont conservés, la recette archivée ne ressort plus dans les
listes ni les calculs sauf à la chercher explicitement. Une réalisation qui a
décrémenté le stock ne se supprime jamais : la correction se fait depuis la
fiche article, comme pour tout autre mouvement.

Le formulaire (bouton « Modifier » sur la fiche d'une recette conservée)
permet d'ajuster titre, cuisine (choisie ou créée à la volée), type de plat,
régimes, portions, les quatre temps, étapes et ingrédients. Chaque ingrédient
se rattache à un produit existant par la même recherche que le reste de
l'application, à une catégorie, ou reste en texte libre. La difficulté suit
automatiquement les étapes et le temps actif ; une correction manuelle la
gèle définitivement, y compris lors des modifications suivantes. Les
ingrédients envoyés remplacent entièrement les précédents. Quitter le
formulaire avec des changements non enregistrés demande confirmation. Voir
`docs/cahier-des-charges.md`, section 12.

**Limites connues.** Pas d'ajout des ingrédients manquants à une liste de
courses (EF-24, qui suppose l'existence de cette liste, repoussée au lot 2) ;
un ingrédient rapproché par approximation (« crème » → *Crème fraîche épaisse
30 %*) est affiché comme probable, compte comme disponible dans la couverture,
et se confirme ou se corrige au moment de cuisiner, jamais avant ; une recette
composée par l'IA peut inventer une proportion, annoncé par sa mention
« proposée par l'IA », jamais masqué. Augmenter le nombre de parts d'une
recette ne fait jamais basculer son groupe global (prête, presque,
incomplète) vers « presque » ou « incomplète » : seul l'état de chaque ligne
d'ingrédient suit les parts, une recette dont chaque produit a au moins un
lot en stock — même insuffisant pour le nombre choisi — reste annoncée
« Prête ». Sans fournisseur d'IA configuré
(`VISION_PROVIDER=none`), l'écran Suggestions n'appelle rien : il l'explique
et renvoie vers les **Réglages** ; le scan photo affiche de même son écran
dédié plutôt qu'un message passager. Voir `docs/decisions/`.

**Choix des modèles.** Réglages › Reconnaissance propose aux administrateurs
deux lignes de choix : le modèle de la photo et celui des recettes. La liste
n'est pas écrite dans le code — elle est demandée au fournisseur, et ne montre
que les modèles que la clé configurée sert réellement, réduits à la **famille
Flash** de la ligne courante : ni instantanés datés, ni aperçus, ni familles
parole, image ou vidéo, qui répondent pourtant à la même API — ni modèles Pro.
L'API Gemini, facturée sur la clé, servirait pourtant un Pro sans rien
demander : elle ne dépend pas de l'abonnement Google AI Plus, qui ne gouverne
que l'appli Gemini et le Mode IA de la recherche. C'est précisément pour cela
que le filtre existe — rien côté Google n'empêcherait de retenir un modèle
plusieurs fois plus cher pour lire une étiquette ou composer une recette, deux
tâches que Flash fait très bien. Si ce filtre ne laissait
rien passer — famille renommée, convention changée — la liste complète reprend
la main plutôt que d'afficher un choix vide. Un nom de modèle
inexistant ne peut donc plus être retenu : c'était la cause de l'écran de
recettes resté vide du 2026-10-04 au 2026-10-06, invisible pour les tests
puisque tous répondent à une doublure locale. « Défaut du serveur » efface le
choix et rend la main à `VISION_MODEL` et `SUGGESTION_MODEL`. Le modèle est
relu à chaque appel : un changement vaut sans redémarrer le conteneur. La
liste dit quels modèles la clé sert, pas lesquels savent chercher sur le web —
un modèle inadapté reste proposé, et l'écran Suggestions affiche alors le
message du fournisseur.

**Recherche web, et son interrupteur.** Les suggestions s'appuient sur l'outil
de recherche de Gemini : une partie des recettes vient de pages réelles, le
reste est composé par le modèle. Cette recherche est facturée **par requête**,
séparément des jetons, et n'entre donc pas dans `VISION_MONTHLY_CAP_CENTS` :
le plafond mensuel de l'application ne la couvre pas. Certaines clés la
refusent aussi, ce qui fait échouer toutes les suggestions. Réglages ›
Reconnaissance porte donc un interrupteur « Recherche web des recettes »,
réservé aux administrateurs. Désactivé, le modèle compose toutes les recettes
lui-même, sans lien vers un site : moins fidèle à l'esprit de la
fonctionnalité, mais gratuit et toujours utile. Quand la recherche est active,
chaque requête réellement exécutée par le modèle est comptée dans le plafond
mensuel, au tarif public de 35 $ pour mille : elles
pèsent bien plus que les jetons, et le plafond les ignorait jusqu'à la 0.12.0.

**Comptes et connexion.** On entre avec un compte Google, et avec rien
d'autre : plus de mot de passe nulle part dans l'interface. Une adresse
inconnue qui se connecte crée une **demande** — aucune session n'est ouverte,
rien de l'inventaire n'est visible — qu'un administrateur valide dans
Réglages › Comptes. Il peut aussi refuser, révoquer un accès (les sessions en
cours sont coupées), rétablir un compte refusé, ou déconnecter tous les
appareils d'un membre. Le statut est vérifié à chaque requête, pas seulement à
la connexion. Sur une base vide, la première connexion Google crée
l'administrateur et les emplacements par défaut. Une porte de secours en ligne
de commande, lancée dans le conteneur, reste disponible si Google devient
inutilisable : voir [Accès de secours](#accès-de-secours).

## Installation

### Prérequis

- Un hôte Docker `amd64` (mini-PC, NAS x86) avec `docker compose`. L'image
  n'est publiée que pour cette architecture ; pour un Raspberry Pi ou un hôte
  arm, la construire localement avec `docker compose -f docker-compose.yml -f
  docker-compose.dev.yml build`.
- Un reverse proxy qui termine le TLS avec un certificat valide (Nginx Proxy
  Manager, Caddy, Traefik…). **Ce n'est pas un confort : l'accès à la caméra
  du téléphone n'est autorisé qu'en HTTPS.**

### Déployer

```bash
mkdir kitchen-inventory && cd kitchen-inventory
curl -fsSLO https://raw.githubusercontent.com/djkix/kitchen-inventory/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/djkix/kitchen-inventory/main/.env.example
mkdir -p docker && curl -fsSL -o docker/backup.sh https://raw.githubusercontent.com/djkix/kitchen-inventory/main/docker/backup.sh
cp .env.example .env
```

Renseigner `.env` : `SECRET_KEY` et `POSTGRES_PASSWORD` (générés avec
`openssl rand -hex 32`), `PUBLIC_URL` (l'adresse HTTPS publique) et
`IMAGE_TAG`. Ce dernier accepte `latest`, qui suit la dernière version
publiée, ou un numéro figé comme `0.6.1` si vous préférez décider de chaque
montée de version. `latest` ne reçoit jamais un commit de développement : les
poussées sur `main` sont publiées sous l'étiquette `main`, réservée aux
essais. Puis :

```bash
docker compose up -d
docker compose logs -f app
```

Le conteneur `app` ajuste les droits du dossier `media` pour l'utilisateur
`node` (l'entrypoint est le seul moment où root intervient ; le serveur tourne
sans privilège), joue les migrations de base avant de démarrer, puis répond
sur `http://127.0.0.1:8888` (port modifiable par `APP_PORT`). Pointer le
reverse proxy vers ce port. Vérification :

```bash
curl -s http://127.0.0.1:8888/api/v1/health
```

La réponse détaille séparément la base, le volume média et les migrations. Un
fournisseur de vision désactivé apparaît dans `degraded` sans empêcher le
service : un placard s'inventorie très bien sans IA.

Sous [Dockge](https://github.com/louislam/dockge), coller le contenu de
`docker-compose.yml` et de `.env` dans une nouvelle stack ; le script de
sauvegarde doit être présent dans `docker/backup.sh` à côté du compose. **Ne
pas y recopier de fragment de `docker-compose.e2e.yml`** : ce fichier de tests
pose `GOOGLE_CERTS_URL`, qui déplace la racine de confiance de
l'authentification (voir [Configuration](#configuration)).

> **Se connecter immédiatement après le premier démarrage, avant d'ouvrir
> l'accès à qui que ce soit.** Sur une base vide, la première connexion Google
> réussie crée l'administrateur : tant que personne ne s'est connecté, la
> place est libre pour le premier qui trouve l'adresse. Concrètement : ne
> publier le nom de domaine dans le reverse proxy qu'une fois
> `GOOGLE_CLIENT_ID` renseigné et votre propre connexion faite, ou garder
> l'accès restreint (réseau local, filtrage d'IP) le temps de le faire. La même
> fenêtre se rouvre après toute restauration sur base vide.

## Première connexion

On se connecte **avec un compte Google**, et avec rien d'autre : il n'y a plus
de mot de passe dans l'application, ni formulaire de connexion, ni écran
d'installation, ni changement de mot de passe. Le flux utilisé est celui du
« jeton d'identité » de Google Identity Services : **pas de client secret**,
une seule valeur à configurer, publique, `GOOGLE_CLIENT_ID`.

### 1. Créer l'identifiant OAuth dans la console Google Cloud

À faire une fois, sur le projet Google Cloud qui sert déjà la clé Gemini (ou
sur un projet neuf, peu importe : le Client ID et la clé d'API n'ont aucun
lien). L'URL publique utilisée ci-dessous est celle de l'instance,
`https://kitchen.djkix.ovh` — la même que dans `PUBLIC_URL`.

1. Ouvrir [console.cloud.google.com](https://console.cloud.google.com) et
   sélectionner le projet en haut de la page.
2. **APIs et services → Écran de consentement OAuth.** Si l'écran n'existe pas
   encore : type d'utilisateur **Externe**, puis renseigner le nom de
   l'application, l'adresse d'assistance et l'adresse du développeur. Aucune
   portée (« scope ») à ajouter : le flux n'en demande aucune au-delà de
   l'identité de base.
3. Sur ce même écran de consentement, **passer l'état en « En production »**
   (bouton « Publier l'application »). Laissé en « Test », seuls les comptes
   déclarés un par un dans la liste des testeurs peuvent se connecter, et la
   session expire au bout de sept jours. Ce n'est pas un risque d'ouverture :
   ce qui ferme la porte ici, c'est la validation par un administrateur
   (étape suivante), pas le mode de l'écran de consentement.
4. **APIs et services → Identifiants → Créer des identifiants → ID client
   OAuth.**
5. Type d'application : **Application web**. Nom : ce que vous voulez
   (« Kitchen Inventory » par exemple), il n'est vu que dans la console.
6. **Origines JavaScript autorisées → Ajouter un URI**, et y mettre
   **l'URL publique exacte** :

   ```
   https://kitchen.djkix.ovh
   ```

   Exacte veut dire **au caractère près** : le schéma (`https://`), le nom
   d'hôte et, seulement s'il n'est pas standard, le port. **Pas de chemin, pas
   de barre oblique finale.** `https://kitchen.djkix.ovh/` et
   `https://kitchen.djkix.ovh/connexion` sont refusés, et Google répond
   alors une erreur `origin_mismatch` que rien n'affiche dans l'application :
   le bouton reste simplement sans effet.
7. **Laisser « URI de redirection autorisés » vide.** Ce flux n'utilise aucune
   redirection ; une URI de redirection ne sert à rien ici et son absence
   n'empêche pas de valider le formulaire.
8. Valider. La console affiche le **Client ID**, de la forme
   `123456789012-abcdefghijklmnop.apps.googleusercontent.com`. Le *client
   secret* affiché à côté **ne sert pas** : ne le copier nulle part.
9. Coller ce Client ID dans `.env` :

   ```
   GOOGLE_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
   ```

   puis `docker compose up -d` (sous Dockge : « Save » puis « Update ») pour
   que le conteneur relise la variable. Le Client ID est servi à l'exécution
   par l'API, jamais figé dans l'interface compilée : il suffit de redémarrer
   le conteneur, il n'y a pas d'image à reconstruire.

> **Changement de domaine = retour dans la console.** L'origine autorisée est
> comparée telle quelle par Google. Le jour où l'instance change d'URL
> (nouveau domaine, passage de `http` à `https`, changement de port), il faut
> ajouter la nouvelle origine dans cette même liste, sinon plus personne ne
> peut se connecter. On peut en déclarer plusieurs : pendant une migration,
> garder l'ancienne et la nouvelle évite toute coupure.

### 2. Le premier compte, puis les suivants

Sur une base vide, **la première connexion Google réussie crée le compte
administrateur** — `ACTIVE` et `ADMIN` — et pose les emplacements par défaut
(cuisine, placard, réfrigérateur, congélateur, cellier), renommables ou
supprimables. Il n'y a rien à faire d'autre que de se connecter — **et il faut
le faire tout de suite** : c'est le premier connecté qui devient
administrateur, pas le propriétaire de la machine. Voir l'avertissement de
[Déployer](#déployer).

Ensuite, l'inscription est ouverte mais **l'accès ne l'est pas**. Une adresse
inconnue qui se connecte crée une **demande** : aucune session n'est ouverte,
l'écran annonce que la demande attend une validation, et la personne ne voit
rien de l'inventaire. Un administrateur la valide dans **Réglages › Comptes**,
qui présente quatre listes :

| Liste | Actions |
| --- | --- |
| Demandes en attente | **Valider** (le compte devient actif) ou **Refuser** |
| Comptes actifs | **Déconnecter** (coupe toutes les sessions, téléphone perdu ; la personne peut se reconnecter), **Promouvoir** / **Retirer admin** (partage de l'administration) ou **Révoquer** (retire l'accès et coupe les sessions en cours) |
| Refusés | **Rétablir** |
| Compte (le vôtre) | **Déconnecter tous mes appareils** |

Un compte refusé ou révoqué n'est jamais supprimé : il porte de l'historique de
réalisations et des notes. Une personne refusée qui se reconnecte reçoit
exactement le même message qu'une demande ordinaire — la page de connexion ne
sert pas à savoir quelles adresses le foyer connaît.

Le statut du compte est vérifié **à chaque requête**, pas seulement au moment
de la connexion : révoquer un accès le coupe immédiatement, même sur un
téléphone déjà connecté.

**L'administration se partage.** Sur la ligne d'un compte actif, **Promouvoir**
en fait un administrateur, **Retirer admin** le ramène au rang de membre. Trois
garde-fous : on ne change pas son propre rôle, on ne rétrograde pas le dernier
administrateur actif, et seul un compte déjà actif change de rôle. Il est
conseillé d'avoir **deux administrateurs** : sinon, perdre l'accès à son compte
Google ne laisse que l'[accès de secours](#accès-de-secours).

> **Révoquer un compte ne révoque pas les jetons de service.** Ceux-ci
> n'appartiennent à personne : ce sont des jetons d'**intégration du foyer**
> (Home Assistant, voir [Intégrations](#intégrations)), pas l'accès d'une
> personne. Si quelqu'un qui partait avait noté un jeton, le supprimer dans
> **Réglages › Jetons de service** — c'est le seul geste qui le coupe.

### 3. Sur le téléphone

« Ajouter à l'écran d'accueil » installe l'application (PWA). Le thème sombre
est activé par défaut, pensé pour un cellier peu éclairé.

## Accès de secours

Si la configuration Google casse — projet suspendu, Client ID effacé, domaine
changé sans mise à jour de l'origine autorisée — **plus personne n'entre**.
C'est le prix assumé de « plus de mot de passe », et c'est pourquoi il existe
une porte de secours. Elle n'est **pas** une route cachée ni une variable
d'environnement : c'est une commande, lancée dans le conteneur, qui n'ouvre
rien tant qu'elle n'a pas tourné.

Depuis le terminal de la stack sous Dockge (ou en SSH, dans le répertoire du
`docker-compose.yml`) :

```bash
docker compose exec app node tools/acces-secours.js adresse@example.org
```

Elle crée ou réactive ce compte en `ACTIVE`/`ADMIN` et affiche, **une seule
fois** :

```
Compte créé : adresse@example.org (ACTIVE, ADMIN)
Mot de passe de secours : …
Valable jusqu'à 18/10/2026 14:13:38, pour une seule connexion.
```

Ce mot de passe est **valable une heure**, **utilisable une seule fois**, et
n'est **jamais réaffiché** : il n'existe en clair nulle part ailleurs, pas même
dans les journaux. Il s'utilise sur une route que l'interface ne présente
nulle part, `POST /api/v1/auth/recovery` :

```bash
curl -i -X POST https://kitchen.djkix.ovh/api/v1/auth/recovery \
  -H 'Content-Type: application/json' \
  -d '{"email":"adresse@example.org","password":"LE-MOT-DE-PASSE"}'
```

La réponse pose le cookie de session habituel. Pour entrer directement dans le
navigateur plutôt qu'avec `curl`, ouvrir la console de l'application sur son
domaine et y lancer le même appel avec `fetch` : le cookie est posé sur place.

> **Le terminal web de Dockge garde ce qu'il affiche.** C'est une page de
> navigateur : le mot de passe reste dans l'historique de défilement de
> l'onglet, et peut survivre à un rechargement. Le dégât est borné — une
> heure, un seul usage — mais le réflexe est de fermer l'onglet du terminal
> une fois la connexion faite, et de ne pas laisser la fenêtre Dockge ouverte
> sur cette sortie.

Si le conteneur ne démarre pas du tout (migration en échec, par exemple), la
variante qui ne suppose pas un conteneur déjà en service :

```bash
docker compose run --rm app node tools/acces-secours.js adresse@example.org
```

Cette commande suppose un accès au serveur. Sans Dockge ni SSH, il n'y a pas
de recours : c'est la limite assumée du dispositif.

## Mise à jour

```bash
# Avec IMAGE_TAG=latest, rien à modifier :
docker compose pull && docker compose up -d
# Avec un numéro figé, le changer d'abord dans .env.
```

Sous [Dockge](https://github.com/louislam/dockge), le bouton « Update » de la
stack fait la même chose. Avec `IMAGE_TAG=latest`, il suffit donc d'un clic ;
avec un numéro figé, il retélécharge la même image et ne change rien tant que
`.env` n'a pas été modifié.

Les migrations de schéma sont appliquées automatiquement au démarrage. Si une
migration échoue, le conteneur affiche la cause, attend trente secondes et
s'arrête sans démarrer sur un schéma partiel ; la base reste dans l'état
précédent. Le déploiement reste volontairement manuel : pas de mise à jour
automatique en production.

Chaque version publiée sur GitHub est accompagnée d'une note de changement
(`CHANGELOG.md`, généré par release-please) ; les migrations incluses sont
visibles dans `prisma/migrations`.

## Sauvegarde et restauration

Le service `backup` produit chaque jour un dump PostgreSQL compressé
(`db-<horodatage>.sql.gz`) et une archive du dossier média
(`media-<horodatage>.tar.gz`) dans `BACKUP_DIR`, avec purge au-delà de
`BACKUP_RETENTION_DAYS` (30 jours). Placer ce répertoire sur un autre disque
que `PGDATA_DIR`.

Restauration à blanc, à tester **avant** la mise en service :

```bash
docker compose exec -T db psql -U "$POSTGRES_USER" -c 'CREATE DATABASE kitchen_restore'
gunzip -c backups/db-<horodatage>.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" -d kitchen_restore
```

Restauration complète (service arrêté) :

```bash
docker compose stop app backup
gunzip -c backups/db-<horodatage>.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
tar xzf backups/media-<horodatage>.tar.gz -C ./media
docker compose start app backup
```

> **Si l'application redémarre sur une base vide** — restauration ratée, dump
> absent, volume perdu — la fenêtre du premier administrateur se rouvre : le
> premier qui se connecte devient administrateur du foyer. Vérifier que la
> restauration a bien repeuplé la base **avant** de remettre le service
> derrière le reverse proxy, et se reconnecter sans attendre.

## Configuration

Toutes les variables sont documentées dans `.env.example`. Les principales :

| Variable | Rôle |
| --- | --- |
| `SECRET_KEY` | Secret de signature des cookies, 32 caractères minimum, obligatoire |
| `PUBLIC_URL` | URL publique HTTPS |
| `GOOGLE_CLIENT_ID` | Client ID OAuth « Application web » de la console Google Cloud, **public** (pas de client secret avec ce flux). Vide = la connexion Google est indisponible et le bouton ne s'affiche pas, l'application devenant inaccessible autrement que par la porte de secours. Obtention : [Première connexion](#première-connexion) |
| `GOOGLE_CERTS_URL` | **Réservée au montage de tests bout en bout, à ne jamais poser ici.** Elle remplace les clés publiques qui valident les jetons Google : qui sert ces clés signe des jetons que l'application accepte. Posée, elle est signalée par un avertissement au démarrage et par `google_certs_url` dans le `degraded` de `/health` |
| `VISION_PROVIDER` | `none` ou `gemini` |
| `VISION_API_KEY`, `VISION_MODEL`, `VISION_BASE_URL` | Clé et modèle du fournisseur (défaut `gemini-3.5-flash`) ; `VISION_BASE_URL` sert pour un proxy. Comme `SUGGESTION_MODEL`, `VISION_MODEL` n'est qu'une valeur de départ : le choix fait dans Réglages prime |
| `SUGGESTION_MODEL` | Modèle des appels recettes — suggestions et réécriture (défaut `gemini-3.5-flash-lite`). Distinct de `VISION_MODEL` : lire une étiquette et chercher une recette sur le web n'appellent pas le même modèle. Comme `VISION_MODEL`, c'est une **valeur de départ** : un administrateur peut la remplacer depuis Réglages, et le choix enregistré prime |
| `SUGGESTION_WEB_SEARCH` | `true` ou `false` (**défaut**) : recherche web réelle pour les suggestions. Éteinte par défaut car facturée à la requête, hors quota gratuit : une clé sans facturation la refuse par un 429, et l'écran reste vide au lieu de montrer des recettes web. Valeur de départ seulement — un administrateur bascule l'option depuis Réglages, et son choix prime |
| `VISION_DAILY_QUOTA` | Appels photo autorisés par jour (50) |
| `VISION_MONTHLY_CAP_CENTS` | Plafond de dépense mensuel en centimes, partagé par le scan photo et les suggestions (500, soit 5 €) ; 0 le désactive. Couvre les jetons **et** les requêtes de recherche web |
| `RECIPE_SUGGESTION_DAILY_QUOTA` | Fournées de suggestions de recettes autorisées par jour (20) |
| `OFF_USER_AGENT` | En-tête demandé par Open Food Facts |
| `EXPIRY_ALERT_DAYS` | Seuil d'alerte par défaut (7), modifiable dans les réglages |
| `LOG_LEVEL` | Niveau des journaux JSON sur la sortie standard |

Les journaux ne contiennent jamais de cookie, de jeton Google, de mot de
passe de secours ni de contenu d'image. Chaque appel au fournisseur de vision est journalisé avec sa latence,
son coût estimé et sa confiance ; les compteurs correspondants (appels du jour
et du mois, coût cumulé, taux de reconnaissance automatique sur trente jours,
part des scans résolus par le cache) sont affichés dans les réglages.

## Intégrations

**Home Assistant et autres lecteurs.** Un jeton de service créé dans
Réglages › Jetons de service donne un accès en lecture seule à l'API. Il
appartient au **foyer**, pas à la personne qui l'a créé : il n'est rattaché à
aucun compte, il ne porte aucun rôle, et **révoquer un compte ne l'invalide
pas**. Un jeton se coupe en le supprimant, et seulement ainsi — le supprimer
quand quelqu'un quitte le foyer, comme on change une serrure.

```bash
curl -H "Authorization: Bearer kit_…" https://kitchen.djkix.ovh/api/v1/stock/expiring?days=7
```

Toute méthode autre que `GET` est refusée avec ce jeton.

**Export.** `GET /api/v1/export/inventory.csv` et `/inventory.json`, derrière
la session ou un jeton de service.

**API.** REST sous `/api/v1`, JSON, erreurs normalisées
`{ "error": { "code", "message", "details" } }` avec des codes stables
(`validation_failed`, `unauthenticated`, `forbidden`, `not_found`, `conflict`,
`insufficient_stock`, `business_rule`, `provider_disabled`, `rate_limited`,
`provider_unavailable`, `provider_invalid_response`, `not_ready`). Les
routes sont décrites dans `docs/cahier-des-charges.md`, section 16.

## Développement

Prérequis : Node 22 et npm 11. Ni Docker ni PostgreSQL ne sont nécessaires
pour les tests : une base PostgreSQL 16 embarquée démarre à la volée.

```bash
npm ci
npm run build -w @kitchen/shared
npm test                      # règles métier + API sur base embarquée
npm run typecheck
npm run lint
```

Lancer l'API et le front en développement (un PostgreSQL accessible est requis
pour l'API, par exemple `docker compose up db`) :

```bash
export DATABASE_URL=postgresql://kitchen:kitchen@localhost:5432/kitchen
export SECRET_KEY=$(openssl rand -hex 32)
export NODE_ENV=development
npm run db:migrate
npm run seed:dev -w @kitchen/api   # jeu de données : 40 produits, 60 lots, 8 recettes avec historique
npm run dev -w @kitchen/api         # http://localhost:3000
npm run dev -w @kitchen/web         # http://localhost:5173, proxy /api
```

Le jeu de développement crée le compte `admin@example.org`, `ACTIVE` et
`ADMIN`, si aucun utilisateur n'existe. Il n'a pas de mot de passe : pour
l'utiliser en local, soit renseigner `GOOGLE_CLIENT_ID` et se connecter avec un
compte Google portant cette adresse, soit ouvrir une porte de secours
(`npx tsx tools/acces-secours.ts votre.adresse@example.org`, qui crée ou
réactive ce compte en administrateur).

Construire l'image localement :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

### Tests bout en bout

Une suite Playwright (section 19) joue les parcours P1 à P6 dans un vrai
Chromium (caméra simulée depuis une vidéo fabriquée) contre **l'image Docker
réellement construite** — jamais un serveur de développement — démarrée par
un montage jetable dédié (`docker-compose.e2e.yml`) : une base PostgreSQL 16
vide et une doublure locale d'Open Food Facts, de Gemini et des clés de
signature de Google (`e2e/fixtures/stub-server.ts`, qui rejoue les fixtures d'
`apps/api/test/fixtures`). Rien n'est persistant : `down -v` ne laisse rien
derrière lui.

Les parcours se connectent par le chemin réel. Ce qui est doublé, c'est la
**paire de clés** qui signe les jetons Google : la doublure frappe des jetons,
l'application lit ses clés publiques chez elle (`GOOGLE_CERTS_URL`, une
variable qui n'existe que pour ce montage) et les vérifie avec
`google-auth-library` comme en production — signature RS256, émetteur,
audience, expiration. Seul le **widget** de Google est remplacé par un bouton
de test : son script ne peut pas se charger sans réseau. Le rendu du vrai
bouton reste donc la seule partie de la connexion qu'aucun test ne couvre.

Couverture actuelle : P1 (inventaire initial, scans enchaînés), P2 (rangement
des courses, DLC saisie aussi bien directement dans le tiroir de validation
par raccourci qu'après l'ajout depuis le bandeau ; hors lecture automatique
de la date, qui n'existe pas encore), P3
(consommation, hors bascule en liste de courses — ni seuils ni liste
n'existent), P4 (consultation, recherche, filtre par emplacement, périme
bientôt, hors vue « à racheter » qui dépend de cette même liste de courses),
P5 (suggestions de recettes, hors cahier des charges, ajouté parce que
c'est la fonctionnalité la plus récente et la plus fragile — y compris le
champ d'ingrédients dictés : pastilles, croix de retrait, autocomplétion
depuis le catalogue, recettes n'utilisant que des combinaisons complètes, et
l'explication affichée quand une combinaison ne rend rien) et P6 (inscription
et validation d'un compte, hors cahier lui aussi : une adresse inconnue se
connecte, voit le message d'attente et n'accède à rien, un administrateur la
valide dans Réglages › Comptes, elle entre). Le mode hors
ligne n'est pas couvert non plus, pour la même raison : il n'existe pas
encore (lot 2). La conservation d'une recette trouvée sur le **web** n'est
pas jouée bout en bout : le récupérateur de pages refuse délibérément le HTTP
et les adresses privées ou de bouclage, et une doublure locale tombe dans les
deux cas à la fois — l'assouplir pour le test reviendrait à tester
l'application avec ce garde-fou désarmé. Le parcours conserve donc une
recette composée par l'IA ; l'extraction d'une page reste couverte par les
tests d'intégration, sur cinq formes de pages réelles. Détail et quinze
décisions dans `docs/specs/2026-10-04-tests-bout-en-bout.md`, jugement rendu
dans `docs/decisions/2026-10-04-tests-bout-en-bout.md`.

**Cette suite ne tourne qu'en CI**, sur `main` après chaque fusion — jamais en
local, faute de moteur de conteneurs sur le Mac de Franck. C'est le
compromis : en échange, le job `e2e` de `.github/workflows/ci.yml` publie
toujours en artefact le rapport Playwright et, à chaque échec, les captures,
vidéos et traces (dossier `e2e/artefacts/`) ainsi que les journaux du
conteneur applicatif — c'est là qu'il faut regarder quand ce job est rouge.

Pour la faire tourner quand même (pousser une branche, ou localement avec
Docker) :

```bash
npm run e2e:up      # application sur http://localhost:3100, base sur localhost:55432, doublure sur localhost:3101
npm run e2e:down
```

Pour démarrer sans fournisseur de vision configuré (`VISION_PROVIDER=none`),
ajouter le fichier de surcharge à la commande `docker compose` plutôt que
d'utiliser le script `npm` :

```bash
docker compose -f docker-compose.e2e.yml -f docker-compose.e2e.none.yml up -d --wait
```

Structure du dépôt (imposée, voir `CLAUDE.md`) : `apps/api` (NestJS, un
dossier par domaine), `apps/web` (React + Vite, un dossier par écran),
`packages/shared` (types, schémas Zod, unités, règles métier pures),
`prisma` (schéma et migrations), `docker`, `docs`, `tools`.

Le document de référence est `docs/cahier-des-charges.md` ; les choix
d'implémentation laissés au jugement sont consignés dans `docs/decisions/`.
Les commits suivent Conventional Commits avec la référence de l'exigence
(`feat(scan): cascade de reconnaissance (EF-03)`).

## Stack technique

TypeScript de bout en bout. NestJS 12 et Prisma 6 sur PostgreSQL 16
(extension `pg_trgm` pour la recherche tolérante) côté API ; React 19, Vite,
Tailwind et `vite-plugin-pwa` côté front ; Zod pour les schémas partagés ;
Google Identity Services (flux « jeton d'identité », vérifié côté serveur
par `google-auth-library`) pour la connexion, Argon2id pour le seul mot de
passe qui subsiste, celui de la porte de secours ; Vitest pour les tests. Une seule image
Docker sert l'API et le front compilé ; l'intégration continue GitHub Actions
vérifie types, lint, tests, cohérence des migrations, puis publie l'image
`amd64` sur GitHub Container Registry à chaque version taguée par
release-please.

## Derniers changements

| Version | Date | Changement |
| --- | --- | --- |
| 0.22.0 | 2026-10-19 | « Mes recettes » et la fiche recette reprises pour le téléphone, où l'application est utilisée en très grande majorité. Sur une suggestion, le bouton unique « Plus d'informations » fait place à **deux boutons**, « Je fais cette recette » et « Annuler » (détail plus bas) : l'ancien libellé promettait une lecture là où le geste enregistre définitivement la recette, et il a fait hésiter. Sur la liste, les onze contrôles de filtre qui occupaient en permanence le haut de l'écran passent derrière un **bouton « Filtres »** unique, posé à droite de la recherche, portant le nombre de filtres actifs et ouvrant un panneau par le bas : rien n'est retiré — les six sélecteurs et les cinq bascules y vivent inchangés —, c'est la place permanente qui disparaît, et la liste commence enfin en haut de l'écran. Le sélecteur **« Trier par » n'est plus affiché** : le tri reste mémorisé par utilisateur, par défaut la note, mais il ne prend plus de place (conséquence assumée : on ne peut plus en changer depuis cet écran). Une recette **s'efface d'un glissement vers la gauche** sur sa carte, qui découvre une action rouge, suivie d'une confirmation — effacer veut dire **archiver** : la recette quitte la liste, garde son historique et ses notes, et la bascule « Archivées » la retrouve entière, rien n'est supprimé de la base. Le glissement seul n'efface jamais, et comme il n'existe ni au clavier, ni au lecteur d'écran, ni à la souris, la même action se découvre aussi au focus et au survol ; chaque bouton est nommé par sa recette (« Supprimer Bibimbap simplifié »), jamais « Supprimer » seul au milieu d'une liste. Sur la fiche, les cinq étoiles de **note du foyer ne s'affichent plus** — elles prenaient trop de place ; la note reste en base, lisible sur les cartes de la liste et toujours le tri par défaut, et la notation après cuisson, par membre, reste intacte dans l'historique. Le **nombre de parts** rejoint le bloc des durées (préparation, cuisson, temps actif, repos), toujours ajustable et toujours le même nombre du premier coup d'œil jusqu'au tiroir de cuisson. **Durée totale et difficulté deviennent des blocs colorés**, sur deux échelles distinctes, avec des jetons du thème et jamais une couleur en dur : la couleur ne porte pas l'information seule, le texte reste écrit. Aucune route ni migration nouvelle — l'effacement utilise l'archivage qui existe depuis le socle du module recettes. Le tiroir d'une suggestion, donc : à gauche **« Je fais cette recette »**, qui conserve et mène droit à la fiche où se règle le nombre de parts ; à droite **« Annuler »**, qui ferme et revient aux suggestions sans rien enregistrer, et reste indisponible tant que la conservation est en cours. Enfin, le **geste « page précédente » ferme le tiroir ouvert** au lieu de quitter l'écran : un glissement vers la gauche depuis le tiroir d'une suggestion basculait sur « Mes recettes » dès qu'on y était passé avant. Rien dans l'application n'écoutait ce glissement — c'est le navigateur qui remontait l'historique, faute d'entrée posée à l'ouverture du tiroir. Le correctif vit dans le composant de tiroir partagé, donc les dix-sept tiroirs de l'application en bénéficient ; fermer par la croix, par Échap ou par Annuler retire l'entrée, pour qu'un Retour ne reste jamais sans effet, et une navigation volontaire (vers la fiche d'une recette conservée) n'est pas avalée au passage. Toute la pile de tiroirs se partage **une seule** entrée : un tiroir qui en remplace un autre — « Code-barres inconnu » puis « Nouveau produit », au scan — la reprend au lieu d'en poser une seconde, sans quoi le second se refermait aussitôt et la saisie manuelle devenait inatteignable. Enfin, l'effacement d'une recette se découvre réellement à la souris : le survol était confié à une règle CSS que rien ne garantissait, et le bouton, quoique présent, ne pouvait être cliqué ni par une souris ni par un outil de test |
| 0.21.0 | 2026-10-19 | Le champ d'ingrédients de l'écran Suggestions passe aux **pastilles** et s'accompagne d'une autocomplétion depuis votre catalogue de produits. Chaque terme validé, par Entrée ou par une virgule, devient une pastille visible portant une croix pour la retirer : « poulet tomate » tapé sans virgule était jusqu'ici compris comme un seul ingrédient de ce nom, sans que rien à l'écran ne le dise — on lisait « Aucune recette avec ces ingrédients » après avoir payé l'appel au modèle. Dès les premières lettres, les produits du catalogue sont proposés sous le champ (« pou » → « Poulet fermier »), navigables aux flèches et fermés par Échap ; un terme choisi dans la liste porte exactement un libellé connu, donc le rapprochement ne dépend plus de l'orthographe. La saisie libre reste entière : « reste de merguez » n'est dans aucun catalogue et s'écrit comme avant. Le retour arrière sur un champ vide retire la dernière pastille, un terme tapé sans être validé part quand même avec la recherche, et les bornes (cinq ingrédients, trente caractères) sont refusées à l'écran, avec leur raison, au lieu d'être rejetées par le serveur. Ni l'API ni la base ne changent : les termes repartent dans la même chaîne séparée par des virgules. Les ingrédients dictés tapés d'un seul tenant, sans virgule — « poulet tomate » — retrouvent désormais les recettes qui contiennent les deux. Un terme multi-mots est d'abord cherché tel quel dans un libellé, puis mot à mot dans l'ensemble des ingrédients de la recette : l'écran annonçait « aucune recette » pour du poulet et de la tomate, après avoir payé l'appel au modèle dont les recettes venaient d'être écartées. La recherche web des recettes est désormais **éteinte par défaut**. Elle était activée depuis la 0.12.0 au motif que c'était la fonctionnalité demandée et non une option — mais elle est facturée à la requête, hors quota gratuit, et une clé sans facturation la refuse : allumée sur une instance non facturée, elle ne produit pas des recettes web, elle produit un écran vide. Le réglage de Réglages › Reconnaissance dit maintenant ce que son activation exige. Le choix d'un administrateur continue de primer sur cette valeur de départ. Un parcours bout en bout joue désormais ce champ dans un vrai navigateur : pastilles, retrait par la croix, autocomplétion du catalogue, recherche limitée aux recettes qui portent tous les termes, et l'explication affichée quand une combinaison ne rend rien |
| 0.20.0 | 2026-10-19 | Les suggestions partent désormais aussi des ingrédients que vous dictez : un champ de texte libre, au-dessus des filtres de l'écran Suggestions, où l'on tape « pommes de terre, merguez » (cinq ingrédients au plus, trente caractères chacun, séparés par des virgules). Ce qui est saisi est imposé — seules des recettes utilisant **tous** ces éléments sont proposées, l'objet étant d'écouler un reste et non de recevoir des idées vaguement proches. Du texte libre et non une sélection dans l'inventaire : un reste de merguez n'a pas de code-barres. Le stock reste pris en compte, en complément, et le modèle reçoit clairement ce qui est imposé et ce qui est seulement disponible. Le réservoir est lu d'abord, filtré sur ces ingrédients : le modèle n'est appelé que s'il en reste moins de six, donc retaper la même demande ne coûte rien. Chaque combinaison a son propre verrou de 24 heures, « merguez, pommes de terre » et « pommes de terre, merguez » comptant pour une seule et même demande. Le singulier et le pluriel mènent à la même recette (« pomme de terre » trouve « Pommes de terre nouvelles », « oeuf » trouve « Œufs ») : sans quoi, selon la façon de taper, on repayait un appel au lieu de lire le réservoir. Un ingrédient que l'on vient de déclarer n'est jamais annoncé comme manquant — ni dans la liste des manques de la carte, ni dans la fiche de la recette, qui l'affiche « Déclaré » —, tandis que le taux de couverture reste calculé sur le stock réel — une recette peut donc afficher « 3 sur 4 » sans lister de manquant, un chiffre prudent valant mieux qu'un chiffre inventé à partir d'une déclaration invérifiable. Une combinaison trop rare rend peu ou rien : l'écran en dit la raison au lieu d'afficher une liste vide et muette. Quand le quota journalier ou le plafond mensuel est atteint, la liste de repli affichée le dit désormais explicitement : les ingrédients demandés n'y sont pas pris en compte. Le champ vide ne change rien au comportement actuel, et aucune modification de la base de données n'est nécessaire |
| 0.19.0 | 2026-10-19 | Tout le réservoir de recettes se parcourt enfin : sous la liste des suggestions, un bouton « Charger plus (12 sur 37) » — même geste et même formulation que « Mes recettes » — allonge la page de douze recettes à chaque appui, jusqu'à soixante, et disparaît quand tout ce que le réservoir connaît pour l'orientation est affiché. Jusqu'ici l'écran n'en montrait que douze et rien ne permettait de voir les autres : un réservoir de trente-sept recettes en cachait vingt-cinq, définitivement, alors que c'est tout l'intérêt de les conserver. Charger plus ne relit que le réservoir, sans jamais appeler le modèle ni dépenser quoi que ce soit, et la fenêtre de classement suit la page demandée — sans quoi les recettes au-delà des trente-six premières n'auraient jamais été ni classées ni rendues. Les suggestions se diversifient : le modèle doit désormais rendre des plats nettement différents les uns des autres, jamais deux variantes d'une même recette, en variant l'ingrédient principal, la technique et la base — le prompt disait jusqu'ici l'inverse en toutes lettres (« aucune variété n'est exigée »), ce qui faisait tourner les propositions autour d'un même plat. Les titres déjà connus pour l'orientation demandée (les quarante plus récents) lui sont cités avec consigne de ne pas les reproposer. Et une relance montre enfin ce qu'elle rapporte : les recettes que l'appel vient de ramener passent en tête de la liste, devant les anciennes même mieux couvertes ; l'ordre habituel reprend au geste suivant, sans rien mémoriser. L'écran Suggestions annonce sous la liste combien de recettes le réservoir connaît pour l'orientation affichée et combien il en contient en tout, et le bouton « Chercher de nouvelles recettes » y est désormais atteignable même quand des résultats s'affichent : il n'existait que dans l'état vide, si bien qu'un réservoir suffisant pour remplir une page ne pouvait plus jamais grandir. Une recette conservée depuis une suggestion arrive désormais avec une cuisine : celle de sa région (Européenne, Asiatique, Méditerranéenne…), créée à la première conservation. Le sélecteur « Cuisine » de « Mes recettes » parle donc du même vocabulaire que celui des Suggestions, et se remplit tout seul — jusqu'ici une recette conservée n'avait aucune cuisine, et ce filtre ne pouvait correspondre à aucune d'elles. L'écran de connexion devient une carte centrée verticalement et horizontalement, et porte le nom de l'application, désormais « Kitchen Inventory » partout — écran de connexion, titre du document et manifeste (l'étiquette sous l'icône de l'écran d'accueil reste « Kitchen », que le système tronque) — il était jusque-là poussé contre le bas de l'écran, ce qui se lisait comme un défaut de mise en page plutôt que comme une intention, et rien n'y disait de quelle application il s'agissait |
| 0.18.0 | 2026-10-18 | Connexion par compte Google, et plus de mot de passe nulle part dans l'interface (section 10). Le flux est celui du « jeton d'identité » : une seule valeur à configurer, `GOOGLE_CLIENT_ID`, publique, sans client secret — les étapes exactes de la console Google Cloud sont dans le README, section « Première connexion ». Les routes `POST /auth/login`, `POST /auth/setup`, `POST /me/password` et `POST /users` disparaissent, ainsi que l'écran d'installation, l'écran Utilisateurs et le verrouillage après cinq échecs, devenu sans objet. L'inscription est ouverte, l'accès ne l'est pas : une adresse inconnue qui se connecte crée une demande, ne voit rien de l'inventaire, et attend qu'un administrateur la valide dans Réglages › Comptes — quatre listes (en attente, actifs, refusés avec « Rétablir », et son propre compte). Un compte refusé ou révoqué n'est jamais supprimé, il garde son historique, et se reconnecter lui rend le même message qu'une demande ordinaire : la page de connexion ne sert pas à énumérer les adresses du foyer. Le statut du compte est vérifié à chaque requête, pas seulement à la connexion : une révocation coupe l'accès immédiatement. Sur une base vide, la première connexion Google crée l'administrateur et les emplacements par défaut. Un jeton dont l'audience n'est pas le Client ID configuré, dont l'adresse n'est pas vérifiée, ou dont l'identité Google ne correspond pas à celle déjà enregistrée pour cette adresse, est refusé. Porte de secours si Google devient inutilisable : `docker compose exec app node tools/acces-secours.js adresse@example.org` pose un mot de passe affiché une seule fois, valable une heure, utilisable une seule fois, sur une route que l'interface ne présente nulle part — le terminal web de Dockge garde ce mot de passe dans son historique de défilement, fermer l'onglet après usage. L'administration se partage : sur la ligne d'un compte actif, « Promouvoir » et « Retirer admin » changent le rôle, avec trois garde-fous (jamais son propre rôle, jamais le dernier administrateur actif, jamais un compte non actif) — sans quoi seul le tout premier compte connecté aurait été administrateur, à jamais. Une connexion Google réussie referme au passage la porte de secours restée ouverte. Les jetons de service appartiennent au foyer et non à une personne : révoquer un compte ne les coupe pas, il faut les supprimer. Migrations `0011_connexion_google` et `0012_acces_secours`. Un parcours bout en bout P6 rejoue l'inscription et la validation, et la construction de l'image vérifie désormais que la commande de secours démarre bien dedans |
| 0.17.0 | 2026-10-15 | Le menu de choix des modèles, dans Réglages › Reconnaissance, se limite désormais à la famille Flash : l'API Gemini ne dépend pas de l'abonnement Google AI Plus et servirait un modèle Pro sans rien demander, facturé sur la clé. Réservoir permanent de suggestions (EF-25, EF-26) : les recettes rapportées par Gemini ne s'effacent plus, elles entrent dans une table dédiée, dédoublonnées, sans limite d'âge. À chaque visite l'application lit ce réservoir, recalcule la couverture contre le stock du moment et n'appelle le modèle que si moins de six recettes correspondent à l'orientation, ou sur relance explicite — consommer un article ne déclenche plus de recherche payante, la signature de recherche ne dépendant plus du stock. Une recette annoncée comme trouvée sur le web n'est retenue que si sa page répond : le contenu est recopié en base une fois pour toutes, le site n'est plus jamais recontacté, pas même au moment de conserver la recette. Les compositions du modèle restent, affichées « composée par l'IA, non vérifiée » et classées après les recettes vérifiées. Une orientation déjà cherchée dans les 24 h n'est pas redemandée : l'écran annonce la cause, l'échéance, et offre un bouton « Chercher de nouvelles recettes ». Le cache de fournée de 24 h disparaît. Migration `0009_suggestion_pool`. Les filtres de « Mes recettes » adoptent par ailleurs la présentation de Suggestions : les six rangées de pastilles défilantes deviennent six sélecteurs natifs par paires, type de plat d'abord, une seule valeur active par facette ; les cinq bascules rapides restent des pastilles sur une rangée Suggestions : l'écran n'affiche plus qu'une douzaine de recettes à la fois, les mieux classées, au lieu de tout le réservoir — une visite ne ralentit plus à mesure qu'il grossit. Le bouton « Chercher de nouvelles recettes » repart bien à chaque appui, y compris après être allé voir « Mes recettes » et revenu. Un stock momentanément vide n'empêche plus de consulter le réservoir : les recettes déjà trouvées restent affichées, avec une couverture nulle. Les seize recettes demandées au modèle entrent toutes au réservoir, au lieu de douze sur seize. La colonne `payload` des fournées, que plus personne ne lisait, est retirée (migration `0010_suggestion_batch_sans_payload`) |
| 0.16.0 | 2026-10-11 | Parcours dirigé des suggestions sur mobile (EF-25). L'onglet Recettes ouvre toujours Suggestions ; la mémorisation du dernier volet consulté est retirée. À l'arrivée, une question bloquante demande le type de plat avant d'afficher quoi que ce soit d'autre, et oriente la recherche initiale — le modèle ne proposant alors plus que ce type. Les quatre rangées de pastilles d'orientation (type de plat, cuisine, durée, facilité) font place à quatre sélecteurs natifs sur deux lignes de deux, qui ne prennent plus la moitié d'un écran de téléphone ; les quatre relancent désormais une recherche à chaque changement, y compris le type de plat, qui ne pouvait plus se contenter de filtrer une fournée déjà réduite à ce même type. Le titre d'une recette tient désormais sur deux lignes au plus, sans jamais être tronqué sur une seule, aussi bien sur une carte de suggestion que sur « Mes recettes » |
| 0.15.0 | 2026-10-08 | Favoris et note directe sur une recette (EF-21). Une étoile à cocher marque une recette comme favorite — liste unique partagée par le foyer — depuis sa fiche et chaque carte de « Mes recettes », indépendamment de la note. La fiche gagne cinq étoiles de note directe, posables sans aucune réalisation enregistrée. Partout où une note s'affiche (carte, fiche, tri), la note directe prime désormais sur la moyenne des réalisations, qui prend le relais en son absence ; la note par réalisation reste par ailleurs inchangée, pour l'historique. Pastille « Favoris » dans les filtres rapides de « Mes recettes ». La fiche d'une recette jamais cuisinée explique désormais l'absence d'historique au lieu de l'afficher vide |
| 0.14.0 | 2026-10-08 | Lot recettes « complétude et usage ». Gemini rend une durée de préparation et une durée de cuisson séparées (`null` quand la recette n'en a pas, jamais un zéro qui se lirait « cuisson : 0 minute »), affichées sur la fiche recette et sur une suggestion ; chaque étape de cuisson doit préciser température du four, intensité du feu et durée, sous peine d'être jugée inexploitable. Chaque ingrédient affiche la photo du produit rapproché et une pastille colorée de l'emplacement de son lot le plus proche de péremption. « Déjà faites » rejoint les pastilles de filtre rapide de Mes recettes, dont chaque carte affiche déjà note et réalisations. Une réalisation passée se note depuis l'historique de la fiche, sans repasser par une cuisson. « Plus d'informations » remplace « Conserver » sur une suggestion (même geste, même effet). Le nombre de parts affiché sur la fiche recette est désormais ajustable : les quantités par ligne et l'état de chaque ingrédient suivent, et ce même nombre préremplit le tiroir de cuisson — un seul champ du début à la fin. L'onglet Recettes de la barre du bas ouvre désormais un écran à deux volets, Suggestions et Mes recettes, avec une bascule en tête visible sans défilement ; l'application se souvient du dernier volet ouvert (ou retombe sur Suggestions si le stockage est indisponible) |
| 0.13.0 | 2026-10-08 | Les suggestions sont classées par type de plat — entrée, plat, dessert, accompagnement, apéritif, petit-déjeuner, boisson — sur la taxonomie qui existait déjà pour « Mes recettes », et qu'une suggestion conservée emporte avec elle. Le type devient la première rangée de filtres des deux écrans, devant la cuisine ; sur Suggestions il filtre la fournée déjà chargée, sans appel ni dépense, et propose une relance ciblée seulement quand il ne reste rien |
| 0.12.3 | 2026-10-08 | La liste des modèles proposée dans Réglages se limite à la ligne courante de Gemini. La clé en déclare une soixantaine — instantanés datés, aperçus, familles parole, image et vidéo — et les dérouler tous pour choisir entre deux modèles utilisables n'était pas tenable au téléphone. Le filtre reste permissif sur le numéro de version, pour qu'une nouvelle génération apparaisse sans modification du code, et rend la liste complète s'il ne laisse rien passer |
| 0.12.2 | 2026-10-07 | Nettoyage après audit d'over-engineering : suppression des adaptateurs Anthropic, OpenAI et Ollama, jamais configurés ni exercés hors de leurs propres tests, et de la dépendance `@anthropic-ai/sdk` qui ne servait qu'au premier. `VISION_PROVIDER` n'accepte plus que `none` et `gemini` ; l'interface de fournisseur est conservée, c'est elle qui rend un autre fournisseur ajoutable le jour venu. Disparaissent aussi l'interface de fournisseur de suggestions (une seule implémentation), trois fabriques qui ne faisaient que déléguer, la variable `SEARCH_COST_USD_PER_1K` (devenue une constante au même titre que la table de prix), `TZ` dans le schéma de configuration (Node la lit seul) et un libellé de modèle transporté jusqu'au navigateur sans jamais être affiché. Environ 250 lignes et une dépendance en moins, à comportement identique |
| 0.12.1 | 2026-10-07 | Retrait de `temperature` des trois appels Gemini (reconnaissance photo, suggestions, réécriture). Google l'a déprécié avec `top_p` et `top_k` : sans effet depuis Gemini 3.6 Flash, ces paramètres renverront une erreur sur les modèles à venir. Le modèle applique désormais ses propres valeurs. Aucun `thinking_budget` n'était utilisé, rien d'autre à migrer |
| 0.12.0 | 2026-10-07 | Interrupteur « Recherche web des recettes » dans Réglages › Reconnaissance, pour les administrateurs. La recherche web est facturée par requête, hors du plafond mensuel de l'application, et certaines clés la refusent — c'est ce refus qui faisait échouer toutes les suggestions chez Franck. Désactivée, le modèle compose les recettes lui-même, avec une consigne explicite de ne pas inventer de lien vers un site. Activée par défaut : c'est la fonctionnalité demandée, pas une option. Les requêtes de recherche entrent désormais dans le plafond mensuel : facturées par requête et non par jeton, elles lui échappaient entièrement, si bien qu'il annonçait une protection qu'il n'assurait pas dès que la recherche était active. Une fournée de douze recettes coûte plus cher en recherches qu'en jetons |
| 0.11.0 | 2026-10-06 | Les administrateurs choisissent les modèles depuis Réglages, section Reconnaissance : une ligne pour la photo, une pour les recettes. La liste proposée est celle que la clé sert réellement, interrogée auprès du fournisseur — un nom de modèle inexistant ne peut donc plus être saisi, ce qui était la cause de l'écran de recettes vide. Le choix prime sur `VISION_MODEL` et `SUGGESTION_MODEL`, et « Défaut du serveur » rend la main à ces variables. Le modèle est relu à chaque appel : un changement vaut immédiatement, sans redémarrage du conteneur |
| 0.10.0 | 2026-10-06 | Le numéro de version ne s'affiche plus qu'au bas de l'écran Réglages, au lieu de chaque écran et de la page de connexion : c'est une information d'administration, et le bandeau « Nouvelle version disponible » continue de signaler partout qu'une mise à jour attend. L'écran Suggestions reprend désormais le message du serveur quand la recherche échoue — « en erreur (404) », « en erreur (429) » — au lieu d'un « le modèle n'a pas pu répondre » qui ne distinguait pas un modèle mal configuré d'un quota épuisé ou d'une coupure réseau, et obligeait à aller lire les journaux du serveur |
| 0.9.2 | 2026-10-05 | Correctif : aucune suggestion de recette n'avait jamais abouti depuis la 0.8.0. Les appels partaient vers `gemini-3.5-pro`, un modèle que l'API Gemini ne sert pas — six tentatives, six 404, et un écran « Mes recettes » vide sans que rien ne l'explique. Le modèle des recettes devient `gemini-3.5-flash-lite` par défaut et se règle à part de la reconnaissance photo, par `SUGGESTION_MODEL` : les deux usages n'ont ni le même besoin ni le même prix. Vingt fois moins cher que le modèle visé, il laisse beaucoup plus de marge sous le plafond mensuel. Aucun test ne pouvait voir cette panne : tous parlent à une doublure locale qui répond quel que soit le nom du modèle |
| 0.9.1 | 2026-10-05 | Correctif d'accessibilité : les cartes de recette et de suggestion n'avaient aucun nom annoncé par les lecteurs d'écran, et étaient introuvables par une requête rôle + nom — Chromium ne remonte pas le contenu d'un rôle `article` dans le nom calculé d'un lien ou d'un bouton ancêtre (EF-23). C'est ainsi qu'un test de bout en bout avait perdu une recette qu'il venait de conserver, contournement visible dans `e2e/p5-suggestions.spec.ts` jusqu'ici. Les deux cartes restent entièrement tactiles (usage à une main en cuisine) et portent désormais un nom explicite — titre et état de couverture (« Prête à 100 % »), la même information que le badge coloré, en mots |
| 0.9.0 | 2026-10-05 | La date de péremption se saisit désormais directement dans le tiroir de validation du scan (EF-02), ce que Franck avait demandé puis fait reporter deux fois : sous la quantité, trois raccourcis (« +3 j », « +1 sem », « +1 mois ») ou un lien « autre date » pour la date libre et le choix DLC/DDM. Rien n'est obligatoire — valider sans y toucher reste le même geste qu'avant, même bouton, même nombre de taps — et le bandeau « + DLC » après l'ajout reste disponible pour rattraper un oubli |
| 0.8.3 | 2026-10-05 | Tests des parcours de bout en bout : vingt-huit scénarios rejouent désormais l'application entière dans un vrai navigateur — ranger les courses en scannant, saisir une date de péremption, consommer un article, chercher dans le stock, demander des suggestions de recettes — contre l'image Docker réellement livrée, sans aucun appel à internet. Ils tournent automatiquement après chaque fusion et doivent passer avant toute publication : une panne du genre de celles trouvées ici (« Mes recettes » vide, recherche sourde aux accents) se verra désormais avant d'arriver sur le mini-PC |
| 0.8.2 | 2026-10-05 | Correctif : la recherche du stock ignore désormais les accents (EF-11). « creme » trouvait « Crème fraîche » côté produits mais pas côté stock, car la requête était désaccentuée puis comparée telle quelle au texte brut en base. La comparaison passe désormais par `unaccent_lite()` (déjà utilisée pour la détection de doublons) appliquée au texte stocké, via une résolution d'identifiants en SQL brut réinjectés dans le filtre existant ; au passage, `unaccent_lite()` ne savait pas déplier les ligatures Œ/œ/Æ/æ (deux lettres) avec `translate()`, qui ne sait remplacer qu'un caractère par un seul autre — « oeufs » ne trouvait donc pas « Œufs » ; migration `0007_unaccent_lite_ligatures` |
| 0.8.1 | 2026-10-05 | Correctif : « Mes recettes » n'affichait jamais une recette conservée. Le filtre `archived=false` envoyé par l'écran était converti en `true` (`Boolean("false")` vaut `true` en JavaScript), si bien que seule la liste des recettes archivées était rendue. Trouvé par les tests bout en bout, qu'aucun test d'API ne pouvait révéler puisqu'ils passent un vrai booléen |
| 0.8.0 | 2026-10-04 | Recettes suggérées à partir du stock (EF-26) : écran Suggestions en entrée du module, point de départ composé depuis le stock réel, recherche web et composition par Gemini, orientation par région/durée/facilité relançant une recherche ciblée, conservation d'une suggestion réécrite au format de l'application dans Mes recettes (EF-25) ; création manuelle retirée, le formulaire ne sert plus qu'à modifier ; `VISION_MONTHLY_CAP_CENTS` plafonne désormais scan et suggestions ensemble, porté à 5 € ; `RECIPE_SUGGESTION_DAILY_QUOTA` ; migrations `0005_recipe_suggestions` et `0006_recipe_client_op_id` ; une recette mal formée n'emporte plus la fournée entière, chaque appel au fournisseur est journalisé pour que quota et plafond soient justes, l'identité d'une suggestion vient de son contenu et non de son rang, code d'erreur `insufficient_stock` dédié ; le scan retrouve son écran dédié quand aucun fournisseur n'est configuré, et les fournées ne faussent plus ses statistiques |
| 0.7.0 | 2026-10-04 | Module recettes (socle) : écran Recettes trié par note avec filtres et tris mémorisés (EF-21, EF-22, EF-23) ; fiche recette avec état de chaque ingrédient et historique noté par membre (EF-23, EF-28) ; cuisson avec décrément plafonné au stock, lots périmés écartés, fusion de produit suivie et choix du produit substitué, ou réalisation sans décrément (EF-18, EF-28) ; archivage d'une recette déjà cuisinée, cuisson d'une recette archivée refusée ; formulaire de saisie et de modification (EF-17) ; recherche de titre insensible aux accents (A22) ; ajout aux courses (EF-24), import par URL (EF-25) et génération par IA (EF-26) laissés au lot 2 |
| 0.6.1 | 2026-10-03 | Publication : « latest » ne suit plus que les versions publiées, les poussées sur main vont sous « main » |
| 0.6.0 | 2026-10-03 | Bandeau de mise à jour : nouvelle version détectée et rechargement proposé, sans interrompre un scan |
| 0.5.0 | 2026-09-21 | Version affichée au bas de chaque écran, alerte quand l'interface en cache est périmée ; publication de l'image limitée à amd64, l'architecture de l'hôte |
| 0.4.0 | 2026-09-21 | Photo prise par l'appareil natif du téléphone, plafond de dépense mensuel en euros |
| 0.3.0 | 2026-09-21 | Scan : validation du produit et de la quantité avant ajout ; fin des ajouts répétés du même article |
| 0.2.2 | 2026-09-21 | Déploiement : droits du volume `media` ajustés au démarrage, plus de `chown` manuel |
| 0.2.1 | 2026-09-21 | Configuration : les variables vides transmises par Compose (`VISION_BASE_URL=`) sont ignorées au lieu de bloquer le démarrage |
| 0.2.0 | 2026-09-21 | Reconnaissance photo : fournisseur Google Gemini (`gemini-3.5-flash`), retenu par défaut ; port hôte 8888 |
| 0.1.0 | 2026-09-21 | Lot 1 : authentification, emplacements, produits, stock et mouvements, scan code-barres, Open Food Facts, vision, export, PWA mobile, stack Docker |

**L'historique complet est dans [`CHANGELOG.md`](./CHANGELOG.md)**, généré
automatiquement par release-please à chaque version publiée. La version en
service est affichée au bas de l'écran **Réglages**, et renvoyée par
`GET /api/v1/health` (champ `version`). Elle n'apparaît plus sur les autres
écrans : c'est une information d'administration, et le bandeau de mise à jour
ci-dessous suffit à signaler qu'une version plus récente attend.

Quand une nouvelle version est déployée, l'application la détecte et propose un
bandeau « Nouvelle version disponible · Recharger » au-dessus de la barre de
navigation. La vérification a lieu au lancement, toutes les trente minutes
application ouverte, et à chaque retour au premier plan — sans quoi une version
déployée en journée n'arriverait sur le téléphone qu'au prochain démarrage
complet. Le rechargement n'est jamais imposé : il interromprait une session de
scan, et le bandeau reste d'ailleurs masqué derrière l'écran de scan.

## Licence

MIT, voir `LICENSE`.
