# Ticket de caisse : remplir l'inventaire sans scanner article par article

**Date** : 2026-10-22
**Statut** : spécification, à valider
**Remplace** : la liste de courses du lot 2 (EF-12, EF-24)

## Pourquoi

djkix range ses courses article par article. Scanner trente articles un par
un prend deux heures ; le ticket de caisse les nomme tous en cinq secondes.

Cette évolution part d'une redéfinition de l'application, énoncée pendant la
conception et plus large que la fonctionnalité elle-même :

> « L'objectif de cette application est d'avoir en tête quel produit j'ai, et
> qu'est-ce que je peux faire avec. Pour les produits fréquents, yaourt, œuf ou
> autre, je n'ai pas besoin de cette application car je sais en gros ce que
> j'ai dans mon frigo. Ce qui n'est pas le cas de ce que j'ai au fond de mon
> placard que je n'ai pas ouvert depuis trois mois. »

L'inventaire sert donc le fond du placard et les produits qui se gardent, pas
le frais. Savoir ce qu'on a, et ce qu'on peut en cuisiner.

## Objectifs

- Remplir l'inventaire depuis un ticket, en un geste, sans scanner chaque article.
- Faire monter les quantités des produits déjà connus plutôt que créer des doublons.
- S'améliorer à l'usage : un libellé de ticket appris une fois est reconnu ensuite.

## Non-objectifs

- Aucune liste de courses. Rien n'est « à acheter » : tout est déjà acheté.
- Aucune date de péremption dans ce parcours.
- Aucun prix conservé, aucun suivi de dépenses.
- Aucune création de produit depuis le ticket seul (voir D6).

## Anti-objectifs

Ce qui ferait échouer l'évolution même si elle fonctionne techniquement :

- **Une ligne cochée en silence sur le mauvais produit.** La quantité monte au
  mauvais endroit et rien ne l'apprend à l'utilisateur. C'est la crainte
  explicite de djkix, et le principe directeur de D6.
- **Un parcours plus lent que le scan article par article.** Si valider un
  ticket demande de trancher quinze cas, il a perdu sa raison d'être.
- **Des produits au nom illisible dans l'inventaire.** « PT DEJ CHOCO 500G »
  n'est pas un nom de produit ; il ne doit jamais atterrir tel quel dans le
  stock.

## Le parcours

1. L'utilisateur ouvre l'onglet **Courses**.
2. Il choisit l'**emplacement** de destination. Un seul pour toute la fournée.
3. Il photographie le ticket, ou dépose une image ou un PDF.
4. Le ticket est lu. Les lignes s'affichent **dans l'ordre du papier**.
5. Il décoche ce qu'il ne veut pas, tranche les cas ambigus, valide.
6. Les produits cochés entrent dans l'emplacement choisi ; les quantités des
   produits déjà présents montent.

## Décisions arrêtées

### D1 — Le ticket alimente l'inventaire, il ne liste pas des courses

L'onglet « Courses » existe déjà et annonce la liste alimentée par les seuils
et les recettes (section 14 du cahier des charges, EF-12 et EF-24, lot 2).
Cette liste est abandonnée ; l'onglet accueille le ticket. Le cahier des
charges est à amender en conséquence (sections 14 et 26).

`Product.minThreshold` et la table `ShoppingListItem` existent en base, sans
aucun usage. Les laisser en place : les retirer demanderait une migration
destructrice pour un gain nul, et le besoin peut revenir.

### D2 — Aucune date de péremption dans ce parcours

Un ticket ne porte pas de DLC, et l'inventaire vise les produits qui se
gardent. Les articles entrent sans date. Le tiroir de validation du scan
photo garde sa saisie de DLC : ce parcours-là n'est pas touché.

### D3 — L'emplacement se choisit avant, une fois pour toute la fournée

C'est ce qui rend le geste rapide. Choisir ligne par ligne reviendrait à
reconstituer le travail que le ticket devait éviter.

### D4 — Entrée : photo, image ou PDF

Le ticket papier se photographie, le ticket dématérialisé arrive en PDF par
courriel. Gemini accepte les deux nativement : aucune bibliothèque de lecture
de PDF, un seul chemin de traitement.

### D5 — Les lignes s'affichent dans l'ordre du ticket

Choisi sur maquette parmi trois organisations. L'ordre du papier permet de
suivre le ticket en main, ligne à ligne. Les reconnues et les inconnues ne
sont donc pas regroupées.

Chaque ligne porte : le nom du produit de l'inventaire, le libellé brut du
ticket en dessous pour vérification, et le mouvement de quantité (« 2 → 3 »).

### D6 — Trois états, jamais deux

C'est la décision centrale.

| État | Ce que c'est | À l'écran |
| --- | --- | --- |
| **Reconnu** | Un seul produit de l'inventaire correspond, sans ambiguïté | Coché, quantité à monter affichée |
| **Ambigu** | Plusieurs produits pourraient correspondre | **Jamais coché.** Demande lequel, ou laisse scanner |
| **Inconnu** | Aucun produit ne correspond | Décoché, libellé brut affiché, marqué « nouveau » |

Un état ambigu ne se résout jamais tout seul au profit du « meilleur »
candidat. djkix : *« je veux être sûr que le doublon est identifié en
amont »*. Une ligne cochée en silence sur la mauvaise huile d'olive fait
monter la quantité au mauvais endroit, et rien ne l'apprend.

Une ligne inconnue ne crée **pas** de produit. L'utilisateur la scannera au
code-barres plus tard, ce qui donne un vrai nom, une marque et une fiche
complète — ce qu'un libellé de caisse ne donnera jamais.

### D7 — Fusion, jamais de doublon

Un produit déjà en stock voit sa quantité monter. Le mouvement passe par
`StockMovement`, comme toute écriture de stock (règle non négociable du
projet) : on insère un mouvement additif, on ne réécrit jamais la quantité.

### D8 — Le multiplicateur du ticket est respecté

« 3 × RIZ BASMATI 1KG » fait monter la quantité de trois.

### D9 — L'application apprend les libellés, et c'est l'utilisateur qui fait le lien

Un libellé de ticket que l'application n'a pas su rattacher est **conservé en
attente**. Sous l'onglet Courses, une liste de ces libellés permet de les
associer à un produit de l'inventaire, quand l'utilisateur le décide. Une fois
l'association faite, le même libellé sur un ticket ultérieur arrive reconnu et
coché.

Le scan au code-barres n'est **pas** modifié : rien ne vient s'y greffer pour
demander si le produit scanné correspond à un libellé en attente. Choix de
djkix, parmi quatre options, le 2026-10-22. Le parcours de scan reste ce
qu'il est ; le rattachement est un geste séparé, fait quand on veut.

Conséquence assumée, dite à djkix au moment du choix : rien ne rappelle de
visiter cette liste. Pour qu'elle ne pourrisse pas, l'onglet Courses porte le
nombre de libellés en attente — c'est le seul rappel, et il est passif.

C'est ce mécanisme qui fait tenir la promesse des cinq secondes dans la durée :
le premier achat d'un produit se scanne et s'associe, tous les suivants se
reconnaissent. Même esprit qu'EF-14, qui mémorise déjà la correction d'une
reconnaissance pour un code-barres donné.

### D10 — L'écran vit sous l'onglet Courses

L'onglet existe, avec un écran « bientôt disponible »
(`apps/web/src/screens/placeholder/coming-soon-screen.tsx`, route `/courses`
dans `app.tsx`). Il est remplacé.

## Les choix que j'ai faits, faute d'avoir été tranchés

Signalés comme tels : ils relèvent du jugement, pas d'une décision de djkix.
Plusieurs répondent à une relecture technique de cette spécification ; les deux
derniers ont été consignés pendant la réalisation, quand il a fallu choisir un
chiffre que rien ne fixait.

- **Un seul appel au modèle** par ticket, photo ou PDF, qui rend toutes les
  lignes.
- **Le ticket consomme son propre quota journalier**, sous une nouvelle valeur
  de l'énumération `AiPurpose`, et non celui du scan photo. Deux raisons : les
  compteurs de l'écran Réglages sont filtrés sur `purpose`, et un ticket
  journalisé comme `VISION` ferait chuter le taux de reconnaissance automatique
  du scan — la panne exacte déjà survenue avec les suggestions de recettes. Le
  **plafond mensuel en euros reste partagé** : c'est le même budget.
- **Le multiplicateur compte des paquets.** « 3 × RIZ BASMATI 1KG » ajoute
  trois unités au produit. Si le produit rapproché n'est pas compté à la pièce
  (suivi en grammes ou en millilitres), la ligne n'est **pas** cochée
  d'office : elle passe en état ambigu. Ajouter « 3 » à un produit suivi en
  grammes écrirait trois grammes dans le stock, soit précisément
  l'anti-objectif.
- **La quantité est modifiable sur la ligne** avant validation. Le modèle peut
  mal lire un multiplicateur, et l'emplacement unique ne laisse aucune autre
  porte de sortie : sans cette correction, un mauvais nombre entre en stock.
- **Le lot visé est le lot sans date** de ce produit dans l'emplacement choisi,
  créé s'il n'existe pas. La règle de fusion existante (section 15) n'unit que
  des lots de même produit, emplacement, unité **et date** : une entrée sans
  date ne peut donc pas rejoindre un lot daté créé par un scan. Le « 2 → 3 »
  affiché est le total du produit dans cet emplacement, lots confondus — c'est
  le chiffre que l'utilisateur a en tête, et il reste vrai.
- **Le fichier est limité à 8 Mo.** Le scan photo plafonne à 4 Mo, mais un
  ticket en PDF de plusieurs pages, ou une photo longue d'un ticket plié, les
  dépasse aisément ; 8 Mo laisse passer ces cas sans accepter n'importe quoi.
- **La route est limitée à 10 requêtes par minute et par adresse.** Entre le
  scan photo (30) et les suggestions (5) : un ticket se lit à la fois, donc
  bien moins vite qu'une rafale de photos, mais plus souvent qu'une demande de
  recettes. Le quota journalier reste le vrai garde-fou de dépense.
- **Les lignes lues sont conservées côté serveur** entre la lecture et la
  validation, sans l'image et sans les prix. Un ticket de trente lignes prend
  des dizaines de secondes à lire et se valide sur un téléphone : sans cela,
  basculer d'application ou rafraîchir perdrait un appel déjà payé.
- **Le ticket lui-même n'est pas conservé** après lecture. Il porte le magasin,
  l'heure, parfois les derniers chiffres d'une carte bancaire. Le scan photo
  conserve ses images parce qu'elles servent à rejouer une reconnaissance
  ratée ; ici le gain ne vaut pas ce qu'on garderait.
- **Cette évolution est EF-29**, une exigence nouvelle. EF-12 et EF-24 sont
  abandonnées, pas redéfinies : ce qu'elles décrivaient n'existera pas.
- **Les lignes non alimentaires sont ignorées** : sacs, remises, total, points
  de fidélité, rendu monnaie.
- **La correspondance est calculée côté serveur**, contre le catalogue de
  produits, par les règles de rapprochement déjà écrites dans
  `packages/shared` pour les ingrédients de recettes (`foldForComparison`,
  tolérante aux accents et aux pluriels). Le modèle lit le ticket ; il ne
  choisit pas le produit.
- **`MediaService.isSupportedMime` refuse aujourd'hui `application/pdf`** et
  doit être élargi pour D4.

## Ce qui est laissé au constructeur

- La forme exacte de la table d'alias et sa migration.
- Le seuil qui sépare « reconnu » d'« ambigu ».
- La présentation du choix sur une ligne ambiguë.
- Le découpage des routes API.
- Le comportement quand le modèle ne lit rien d'exploitable.

## Contraintes du projet qui s'appliquent

- TypeScript strict, `any` interdit hors tests ; libellés en français.
- Schémas Zod définis une seule fois dans `packages/shared`.
- Règles métier en fonctions pures testées dans `packages/shared`.
- Aucune modification de schéma sans migration Prisma versionnée.
- Aucun test ne dépend du réseau : réponses du modèle rejouées depuis des fixtures.
- `README.md` et la ligne de changelog mis à jour dans le même commit.
