# Dossier de maquette — état de l'interface au 2026-11-03

Tout ce qu'il faut pour redessiner l'application sans ouvrir le code : jetons,
navigation, écrans, états, vocabulaire réel. Relevé sur la 0.37.1.

Ce document décrit **ce qui existe**. Il ne dit pas ce qu'il faut changer.

---

## 1. Le contexte

Inventaire alimentaire familial, auto-hébergé, utilisé **debout dans la
cuisine, à une main, sur téléphone**. PWA installée sur l'écran d'accueil
(Android et iOS) ; pas de version de bureau pensée comme telle.

- Largeur de travail : **375 à 430 px**. Le contenu est centré et borné à
  `max-w-lg` (512 px) au-delà.
- Deux utilisateurs réguliers, un administrateur. Connexion par compte Google,
  aucun mot de passe dans l'interface.
- Cible de confort tactile : **44 px** minimum pour tout ce qui se touche.
- Zones sûres iOS respectées en haut et en bas (`safe-area-inset`).

---

## 2. Jetons de style

Une seule famille de jetons, redéfinie pour le thème clair. Le réglage est
dans Réglages › Apparence : clair, sombre, ou suivi du téléphone.

### Couleurs

| Jeton | Sombre | Clair | Rôle |
| --- | --- | --- | --- |
| `ink` | `#111716` | `#f7f5ef` | Fond de page |
| `surface` | `#1a2221` | `#ffffff` | Carte posée sur le fond |
| `raised` | `#243030` | `#e6e2d7` | Élément dans une carte, bouton secondaire |
| `line` | `#2f3d3c` | `#ddd8ca` | Filets, bordures |
| `fg` | `#f3efe6` | `#141a19` | Texte principal |
| `muted` | `#98a5a2` | `#5d6b68` | Texte secondaire |
| `faint` | `#6b7877` | `#7a847f` | Texte tertiaire, placeholders |
| `accent` | `#8fd3c6` | `#1f6f60` | Actions, état actif |
| `accent-deep` | `#0f2a26` | `#d8ece6` | Fond d'une pastille accent |

Couleurs d'état, **réservées à la péremption** :

| Jeton | Sombre | Clair | Sens |
| --- | --- | --- | --- |
| `danger` / `danger-deep` | `#ff6b6b` / `#3a1717` | `#b3261e` / `#fce3e3` | DLC dépassée |
| `warn` / `warn-deep` | `#ff9f43` / `#3b2410` | `#9a5700` / `#fde8cf` | DDM dépassée |
| `soon` / `soon-deep` | `#f5c84c` / `#3a3012` | `#7a5d00` / `#fdf0c8` | Périme bientôt |

Température de stockage, **jamais confondue avec une alerte** :

| Jeton | Sombre | Clair | Sens |
| --- | --- | --- | --- |
| `chilled` / `chilled-deep` | `#7ec8f0` / `#122d42` | `#0d5d85` / `#d9eefb` | Réfrigéré |
| `frozen` / `frozen-deep` | `#d4f1f9` / `#1e4d5c` | `#1e6477` / `#ddf2f8` | Congelé |

Le fond clair n'est **pas** blanc : sous une lampe de cuisine, il éblouit.

### Formes et rythme

- Rayons : carte `14px`, tiroir `22px`, contrôles `12px` (`rounded-xl`).
- Barre de navigation : `76px` de haut. Cible tactile : `44px`.
- Marge latérale de contenu : `16px` (`px-4`). Écart entre cartes : `8px`.
  Écart entre sections : `20px`.

### Typographie

Police système (`system-ui`), aucune police chargée. Corps à `15px`,
interligne `1.45`. Échelle réellement employée :

| Taille | Emploi |
| --- | --- |
| `34px` semi-gras | Quantité, sur la fiche article seulement |
| `22px` semi-gras | Titre d'écran |
| `16px` | Nom d'un article, d'une recette ; champs de saisie |
| `15px` | Texte courant, libellés de boutons |
| `14px` | Texte secondaire, sélecteurs |
| `13px` | Métadonnées, titres de groupe, états vides |
| `12px` | Libellés de la barre de navigation |

Tout nombre est en **chiffres tabulaires** (classe `.tnum`) : quantités,
comptes à rebours, compteurs. Les colonnes ne dansent pas.

### Animations

Trois seulement, toutes courtes : montée du tiroir (180 ms), entrée d'un
toast (160 ms), pulsation douce d'un élément en attente. Toutes supprimées
sous `prefers-reduced-motion`.

---

## 3. Navigation

**Barre basse fixe, cinq emplacements**, dont le centre est un bouton rond de
scan en relief :

```
Stock  |  Recettes  |  (scan)  |  Courses  |  Réglages
```

- Icône 24 px au-dessus d'un libellé 12 px. Actif = `accent`, inactif = `muted`.
- L'onglet Courses porte une **pastille comptée** quand des libellés de ticket
  attendent d'être rattachés.
- L'onglet Recettes ouvre toujours **Suggestions**, jamais « Mes recettes ».

**En-tête d'écran** : collant, `56px` minimum, fond semi-opaque flouté.
Flèche de retour à gauche (absente sur les quatre onglets), titre `22px`,
sous-titre `13px` sous le titre, actions à droite.

Au-dessus de la barre basse, un **bandeau de mise à jour** apparaît quand une
nouvelle version est servie ; il n'est jamais appliqué sans un geste.

### Carte des écrans

| Adresse | Écran | Atteint depuis |
| --- | --- | --- |
| `/` | Stock | Onglet |
| `/stock/:id` | Fiche article | Carte du stock |
| `/perime-bientot` | Périme bientôt | En-tête du stock |
| `/scan` | Scan plein écran | Bouton central |
| `/recettes` | Suggestions | Onglet |
| `/recettes/parler` | Demande parlée | Micro, en-tête de Suggestions |
| `/recettes/bibliotheque` | Mes recettes | Bascule en haut de Suggestions |
| `/recettes/:id` | Fiche recette | Carte de Mes recettes |
| `/recettes/:id/modifier` | Modifier la recette | Fiche recette |
| `/courses` | Ticket de caisse | Onglet |
| `/courses/:id` | Ticket en cours de relecture | Après la lecture |
| `/reglages` | Réglages | Onglet |
| `/reglages/emplacements` | Emplacements | Réglages |
| `/reglages/jetons` | Jetons de service | Réglages |
| `/produits/nouveau` | Créer un produit | État vide du stock |
| `/connexion` | Connexion Google | Hors session |

---

## 4. Les écrans

### 4.1 Stock — l'écran d'entrée

En-tête « Stock », sous-titre « *n* articles », action « Périme bientôt » en
jaune avec une horloge.

Sous l'en-tête, **un bloc de filtres toujours visible** :
- champ de recherche pleine largeur, loupe à gauche, « Rechercher un article » ;
- un sélecteur à deux segments : **Emplacement** / **Péremption** ;
- quatre pastilles rondes : **Tout**, **Bientôt**, **Dépassés**, **Terminés**.

Puis la liste, **groupée** avec un titre de groupe `13px` et le compte à
droite. Groupes par emplacement (`Cuisine › Frigo`) ou par péremption
(`Dépassés`, `Périment bientôt`, `Plus tard`, `Sans date`).

**Carte d'article** (72 px de haut) :

```
┃ [img 48]  Nom du produit                    ┌───────┐  ┌───┐
┃           Marque — 500 g — Frigo            │  J-3  │  │ − │
┗                                             └───────┘  └───┘
```

- un **rail vertical de 4 px** à gauche, coloré par l'état : rouge DLC
  dépassée, orange DDM dépassée, jaune bientôt, transparent sinon ;
- vignette 48 px ou, à défaut, l'émoji de la catégorie ;
- nom `16px`, puis marque, quantité (en gras clair) et emplacement en `13px` ;
- une **pastille de compte à rebours** : `J-3`, `Aujourd'hui`, `J+2`, `—`,
  précédée d'une icône si la date est estimée ou l'article ouvert ;
- un **bouton « − » de 44 px** : un appui consomme un pas, un appui long
  consomme tout. Chaque consommation déclenche un toast **annulable**.

Un bouton « Charger plus (*x* sur *y*) » en bas si la liste est paginée.

**États vides**, tous rédigés (titre + explication + action) :
- stock vide → « Le stock est vide » + « Commencer à scanner » ;
- recherche sans résultat → « Rien ne correspond à « *mot* » » + « Créer « *mot* » » ;
- un par pastille (rien ne périme, aucune date dépassée, aucun article terminé).

### 4.2 Fiche article

En-tête : nom du produit, marque en sous-titre, retour vers le stock.

1. **Bandeau haut** : image 112 px et, à droite, la **quantité en 34 px**,
   le nom d'origine et le code-barres.
2. **Deux tuiles côte à côte**, 72 px : *Emplacement* (nom, ouvre un tiroir de
   choix) et *Date* (date + pastille de compte à rebours, ou « Ajouter une
   date »).
3. **Bloc nutritionnel** si Open Food Facts l'a fourni (Nutri-Score).
4. **Historique des mouvements**, sous un titre « Mouvements ».

**Barre d'action fixe en bas**, au-dessus de la navigation, sur un dégradé :
« Consommer » (large, accent), « Ouvrir » si fermé, et une corbeille rouge.

### 4.3 Périme bientôt

Même carte que le stock, non groupée, l'emplacement toujours affiché, et un
bouton « Jeter » sous chaque carte. Sous-titre : « Sous *n* jours, dates
dépassées comprises ». Action d'en-tête : « Seuil ».

### 4.4 Scan

Caméra **plein écran**, hors de la coque : pas de barre de navigation.
- bandeau haut : l'emplacement courant, changeable ;
- fermeture en haut ;
- un bouton pour photographier un produit **sans code-barres** ;
- rafale continue : la caméra ne se ferme pas entre deux articles ;
- **tiroir de validation** à chaque reconnaissance : nom, quantité, puis trois
  raccourcis de date (**+3 j**, **+1 sem**, **+1 mois**) et un lien « autre
  date » (DLC ou DDM). Rien n'est obligatoire ;
- bandeau bas : le dernier article ajouté, avec « annuler » et « + DLC ».

### 4.5 Suggestions — l'entrée du module recettes

En-tête « Suggestions », sous-titre « À partir de votre stock », **icône de
micro** à droite (demande parlée).

Sous l'en-tête, une **bascule à deux volets** : *Suggestions* / *Mes recettes*.

**Première visite : une question bloquante.** Tant qu'aucun type de plat n'est
choisi, rien d'autre ne s'affiche — ni liste, ni squelette, ni filtres.

Ensuite :
- un **champ d'ingrédients à pastilles** (ce qui y est tapé est imposé à
  chaque recette), avec un bouton **Filtres (*n*)** à sa droite ;
- le panneau Filtres est un tiroir : **quatre sélecteurs natifs sur deux
  lignes de deux** — type de plat, région, durée (15/30/60 min), difficulté —
  et un bouton « Voir les recettes ». Chaque geste relance une vraie
  recherche, jamais un tri local.

**Carte de suggestion** :

```
Titre de la recette sur deux lignes au plus     [ Prête · 100 % ]
Plat · Italienne · 35 min · Facile
marmiton.org          (ou : Composée par l'IA, non vérifiée)
Manque : crème fraîche, basilic
```

La pastille de couverture est verte (*Prête*), jaune (*Presque*) ou grise
(*Incomplète*), suivie d'un pourcentage.

**Pied de liste** : défilement infini, puis « *n* recettes connues pour cette
orientation · *m* en tout » et un bouton « Chercher de nouvelles recettes ».

**États** :
- attente explicite avec roue et « Recherche de recettes en cours… » +
  « Cela peut prendre plusieurs secondes » ;
- bandeau fin « Recherche d'une nouvelle fournée… » quand la liste précédente
  reste affichée ;
- **attente gardée** (Gemini saturé) : « En attente de Gemini / Service
  saturé. Votre demande repartira seule dans environ 20 minutes. Vous pouvez
  fermer l'application. / Vous recevrez une notification dès que vos recettes
  seront prêtes. » ;
- erreurs distinctes : aucun fournisseur configuré, stock insuffisant,
  demande non comprise, quota, panne.

Toucher une carte ouvre un **tiroir de conservation** : c'est là, et
seulement là, que la recette entre dans « Mes recettes ».

### 4.6 Demande parlée

Écran à part : on enregistre (60 s et 4 Mo au plus), le modèle rend à la fois
ce qu'il a entendu et les recettes. L'audio n'est conservé nulle part.

### 4.7 Mes recettes

Recherche + bouton **Filtres** (onze contrôles dans un tiroir), tri mémorisé
(« Les mieux notées », « Réalisables avec le stock », « Les plus faites »,
« Les moins récentes »). Pas de création manuelle. Cartes semblables aux
suggestions, avec étoile de favori.

### 4.8 Fiche recette

Titre en en-tête, puis :
1. **Résumé** : durée, difficulté, étoile de favori, et quatre temps
   (Préparation, Cuisson, Temps actif, Repos) ; nombre de parts ajustable,
   qui met les quantités à l'échelle.
2. **Ingrédients**, chacun avec son état face au stock : *Disponible*,
   *Insuffisant*, *Non vérifiable*, *Manquant*, *Hors inventaire*.
3. **Étapes** numérotées, le numéro en accent.

Actions : cuisiner (décrémente le stock, plafonné, avec choix du produit
substitué), réaliser sans décrément, noter sous sept jours, archiver.

### 4.9 Courses — ticket de caisse

Il n'y a **aucune liste de courses**. L'onglet est l'écran du ticket.

Avant la photo : un paragraphe d'explication, une ligne « Choisir
l'emplacement » (épingle, obligatoire), puis un gros bouton
« Photographier le ticket ».

Après la lecture, **les lignes dans l'ordre du ticket**, dans une carte à
filets : case à cocher, nom reconnu ou libellé brut, quantité corrigible, et
pour une ligne ambiguë le choix du produit. Une ligne inconnue n'a pas de
case : « Produit inconnu : à scanner par son code-barres. »

En bas de l'écran, une **section repliée** des libellés jamais reconnus, dont
le nombre orne l'onglet.

### 4.10 Réglages

Liste de **sections en accordéon**, chacune avec une pastille de résumé et un
point de couleur : Reconnaissance, Apparence, Inventaire (seuil « périme
bientôt », emplacements), Foyer (jetons de service), Sauvegarde, Export,
Comptes (administrateur), Compte.

### 4.11 Connexion

Un seul écran, un seul bouton Google. Sur une base vide, il explique que la
première connexion crée l'administrateur.

---

## 5. Composants partagés

- **Bouton** : variantes `primary` (accent plein), `secondary`, `outline`,
  `ghost`, `danger` ; tailles `sm` / normal / `lg` ; état de chargement.
- **Tiroir (`Sheet`)** : monte du bas, rayon 22 px, titre et description,
  empile une entrée d'historique (le retour arrière le ferme).
- **Toast** : en bas, au-dessus de la navigation, 160 ms, souvent porteur
  d'un « Annuler ».
- **État vide** : titre, phrase d'explication, action. Jamais un écran muet.
- **État d'erreur** : titre, message du serveur repris tel quel, « Réessayer ».
- **Squelettes** de liste pendant le chargement.
- **Pastille d'emplacement**, **badge Nutri-Score**, **étoile de favori**,
  **notation par étoiles**.

---

## 6. Le vocabulaire réel

À utiliser tel quel dans une maquette : ce sont les libellés affichés.

- **Unités** : pièce, g, kg, ml, l, paquet, boîte, sachet.
- **Types de plat** : Entrée, Plat, Dessert, Accompagnement, Apéritif,
  Petit-déjeuner, Boisson.
- **Régions** : Européenne, Méditerranéenne, Asiatique, Latino-américaine,
  Moyen-orientale, Africaine, Nord-américaine.
- **Difficulté** : Très facile, Facile, Intermédiaire, Difficile.
- **Couverture** : Prête, Presque, Incomplète.
- **Ingrédient face au stock** : Disponible, Insuffisant, Non vérifiable,
  Manquant, Hors inventaire.
- **Régimes** : Végétarien, Végétalien, Sans gluten, Sans lactose, Sans porc.
- **Étiquettes de recette** : Valeur sûre, À oublier, Jamais faite, Pas faite
  depuis longtemps.
- **Compte à rebours** : `J-3`, `Aujourd'hui`, `J+2`, `—`.

Règle d'écriture : **anglais pour le code, français pour tout ce qui se lit**.
Les messages d'erreur sont des phrases, pas des codes.

---

## 7. Contraintes qui tiennent, quelle que soit la maquette

1. **Une main, debout.** Les actions fréquentes restent dans le tiers bas.
2. **Les couleurs d'état ne servent qu'à la péremption.** Un emplacement ne
   doit jamais ressembler à une alerte.
3. **Aucun écran muet** : chaque état vide ou en erreur dit pourquoi et ce
   qu'on peut faire.
4. **Les deux thèmes se valent.** Rien ne doit n'être lisible que dans l'un.
5. **44 px** pour tout ce qui se touche ; les sélecteurs sont natifs.
6. **Une attente de modèle se dit** : roue, durée, et promesse de
   notification seulement si elle est autorisée.
7. **Rien ne se fait passer pour une recette qui existe** : une composition du
   modèle le déclare.
