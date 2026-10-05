# Tests bout en bout des parcours

2026-10-04 · Franck, avec assistance de Claude · révision 1

Spécification de la suite Playwright exigée par la section 19 du cahier : les parcours P1 à P4 de la
section 3, joués dans un vrai navigateur, contre **l'image Docker réellement publiée**.

Le document de référence reste `docs/cahier-des-charges.md`. Cette spécification ne s'en écarte pas ;
elle restreint la couverture à ce qui existe, et dit pourquoi (section 3). Les décisions sont notées
**[C1]** à **[C15]** et récapitulées en annexe.

## 1. Intention

Les suites actuelles — 181 tests de règles pures, 210 d'intégration API, 112 de composants — ne
disent rien de l'application assemblée. Deux incidents récents l'ont montré : la compilation de
production cassée par un fichier de test mal placé, que seule la CI a vue, et l'étiquette `latest`
qui ne bougeait pas, que personne n'a vue pendant deux semaines. Les deux venaient du même endroit :
l'écart entre ce qui est testé et ce qui est livré.

Cette suite ferme cet écart. Elle démarre **l'image publiée**, une base jetable à côté, et joue les
parcours au navigateur. Un parcours qui passe ici veut dire que l'application livrée fonctionne.

## 2. Décisions de cadrage

| Question | Décision |
| --- | --- |
| Couverture | Ce qui existe aujourd'hui ; chaque incrément ajoutera ses parcours **[C1]** |
| Cible | L'image Docker, construite depuis le `Dockerfile` du dépôt, et une base PostgreSQL jetable **[C2]** |
| Exécution | **CI uniquement** : Franck n'a pas Docker sur son Mac **[C3]** |
| Cadence | Sur `main` après fusion, pas sur les pull requests **[C4]** |

Conséquence assumée de **[C3]** et **[C4]** : une régression n'est connue qu'une fois le code sur
`main`. Le filet est le retour arrière, en épinglant `IMAGE_TAG` dans Dockge. Ce filet ne couvre pas
les migrations de base, que Prisma n'applique que vers l'avant.

## 3. Périmètre : ce qui est couvert, et ce qui ne peut pas l'être

| Parcours | Couvert | Laissé de côté, et pourquoi |
| --- | --- | --- |
| **P1 — Inventaire initial** | emplacement choisi une fois, scans enchaînés caméra ouverte, ajout en quantité 1, bandeau d'annulation de cinq secondes | — |
| **P2 — Rangement des courses** | le tiroir de validation, la quantité saisie article par article, la DLC saisie après l'ajout depuis le bandeau « Ajouté : … » | la saisie de la DLC **dans le tiroir de validation lui-même** (demandée, reportée) et sa lecture automatique par OCR (inexistante) |
| **P3 — Consommation** | décrément depuis la recherche, appui long et « tout consommer » | le basculement en liste de courses au seuil : ni seuils ni liste n'existent (EF-24) |
| **P4 — Consultation** | recherche par nom, filtre par emplacement, « périme bientôt » | la vue « à racheter », qui dépend de la liste de courses |
| **P5 — Suggestions** | fournée affichée, orientation par région, conservation d'une recette, qui apparaît dans Mes recettes | hors section 3 du cahier : ajouté ici **[C5]** parce que c'est la fonctionnalité la plus récente et la plus fragile |
| Mode hors ligne | — | `POST /sync` et la file IndexedDB n'existent pas (lot 2) |

Chaque ligne « laissée de côté » devient un parcours le jour où la fonctionnalité arrive : c'est la
tâche de l'incrément qui la livre, pas de celui-ci **[C1]**.

## 4. Le montage sous test

Un `docker-compose.e2e.yml` dédié **[C6]**, distinct de celui de production, qui démarre :

1. **l'application**, image construite depuis le `Dockerfile` du dépôt dans le job lui-même — pas
   l'image publiée sur GHCR **[C7]**. Construire sur place rend le job autonome : il n'attend aucun
   autre workflow et teste exactement le code du commit ;
2. **PostgreSQL 16**, base vide, détruite à la fin ;
3. **la doublure des services externes** (section 6).

L'application est configurée par variables d'environnement, comme en production : `VISION_PROVIDER`,
`VISION_BASE_URL` et `OFF_BASE_URL` pointent vers la doublure. Aucune clé réelle, aucun appel sortant
**[C8]**.

Les migrations sont appliquées par l'entrypoint de l'image, comme chez Franck : c'est précisément ce
qu'on veut éprouver.

## 5. Le jeu de données

La semence de développement existante (`prisma/seed/dev.ts`) est rejouée dans la base jetable
**[C9]** : trois emplacements imbriqués, quarante produits, soixante lots aux dates relatives, huit
recettes. Le cahier la décrit déjà en section 19, elle est maintenue, et la réutiliser évite un
second jeu qui divergerait.

Les dates restent relatives à l'exécution : un jeu figé casserait tout seul au bout de quelques
semaines.

Chaque fichier de test repart de la semence **[C10]** : les parcours ne se transmettent pas d'état,
et l'ordre d'exécution n'a pas à être deviné.

## 6. La doublure des services externes

Un petit serveur HTTP lancé dans le montage, qui rejoue des fixtures **[C8]** :

| Service | Branché par | Rejoue |
| --- | --- | --- |
| Open Food Facts | `OFF_BASE_URL` | une fiche produit connue, un code-barres inconnu, une panne |
| Gemini — vision | `VISION_BASE_URL` | une reconnaissance sûre, une incertaine |
| Gemini — suggestions | `VISION_BASE_URL` | une fournée de douze recettes, dont huit web |

Les fixtures sont **celles qui existent déjà** dans `apps/api/test/fixtures/` **[C11]** : une réponse
du modèle qui diverge entre les tests d'intégration et les tests bout en bout ne prouverait plus rien.

**La conservation d'une recette venant du web n'est pas jouée ici [C15].** Le récupérateur de pages
refuse délibérément le HTTP et toute adresse privée ou de bouclage — c'est un garde-fou, puisqu'il
suit une URL choisie par un modèle sur une machine du réseau domestique. Une doublure locale tombe
dans les deux cas à la fois. L'assouplir pour les tests reviendrait à tester une application dont le
garde-fou est désarmé, c'est-à-dire à ne pas le tester du tout. Le parcours bout en bout conserve
donc une recette **composée par l'IA**, qui ne déclenche aucune récupération ; l'extraction d'une
page reste couverte par les tests d'intégration, qui la jouent sur cinq formes de pages réelles
depuis des fixtures.

## 7. La caméra

Chromium est lancé avec `--use-fake-device-for-media-stream` et
`--use-file-for-fake-video-capture`, alimenté par une vidéo fabriquée à la construction depuis une
image de code-barres **[C12]**. C'est le point le plus fragile du montage : si la lecture du
code-barres s'avère instable en vidéo simulée, le repli est de piloter le décodeur par une entrée de
test plutôt que par la caméra, en l'assumant et en le disant — mais on essaie d'abord la vraie
chaîne, qui est tout l'intérêt de l'exercice.

## 8. Le service worker

L'application est une PWA dont le service worker s'enregistre sur la version construite. Il est
**laissé actif** **[C13]** : le désactiver reviendrait à tester une application différente de celle
installée sur le téléphone de Franck, et c'est exactement le genre d'écart que cette suite existe
pour supprimer. Les tests attendent donc que le réseau soit au repos plutôt que de supposer un
rendu immédiat.

## 9. La CI

Un job `e2e` dans `.github/workflows/ci.yml`, déclenché **sur `main` seulement** **[C4]**, après le
job `check`. Il construit l'image avec le cache de `buildx`, démarre le montage, joue les parcours,
et publie en artefact le rapport Playwright, les captures et les vidéos des échecs **[C14]** —
puisque Franck ne peut pas rejouer localement, la trace est tout ce qu'il aura.

Un échec du job `e2e` n'empêche pas la publication de l'image : elle est déclenchée par le tag, que
release-please pose après coup. Franck reste libre de publier en connaissance de cause.

## 10. Ce que cette spécification ne tranche pas

- Le nombre d'exécutions parallèles de Playwright : à régler sur le temps réellement observé.
- La tolérance aux lenteurs du premier chargement : à calibrer, sans multiplier les attentes fixes.
- Si la vidéo simulée se révèle instable, le repli de la section 7 : à décider sur mesures, pas
  d'avance.

## Annexe : décisions du 2026-10-04

| Réf | Décision |
| --- | --- |
| C1 | On couvre ce qui existe ; chaque incrément ajoute ses parcours |
| C2 | La cible est l'image Docker et une base jetable |
| C3 | Exécution en CI uniquement, faute de Docker sur le Mac de Franck |
| C4 | Sur `main` après fusion, pas sur les pull requests |
| C5 | Un parcours « suggestions » est ajouté aux quatre du cahier |
| C6 | Un `docker-compose.e2e.yml` dédié, distinct de la production |
| C7 | L'image est construite dans le job, pas tirée de GHCR |
| C8 | Aucun appel réseau : doublure locale branchée par les URL de base existantes |
| C9 | La semence de développement sert de jeu de données |
| C10 | Chaque fichier de test repart de la semence |
| C11 | Les fixtures sont partagées avec les tests d'intégration |
| C12 | Caméra simulée par Chromium depuis une vidéo fabriquée |
| C13 | Le service worker reste actif |
| C14 | Rapport, captures et vidéos publiés en artefact à chaque échec |
| C15 | La conservation d'une recette web n'est pas jouée bout en bout : les garde-fous du récupérateur interdisent une doublure locale, et les désarmer ôterait tout sens au test |
