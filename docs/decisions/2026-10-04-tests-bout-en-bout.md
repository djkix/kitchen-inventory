# Tests bout en bout des parcours

2026-10-05 · Franck, avec assistance de Claude

Le cahier des charges (`docs/cahier-des-charges.md`) fait autorité. Le cadrage
de cette suite et ses quinze décisions (**C1** à **C15**) sont documentés dans
`docs/specs/2026-10-04-tests-bout-en-bout.md`, qui fait référence : ils ne sont
pas recopiés ici. Ce document consigne seulement le jugement rendu une fois la
suite livrée.

## CI uniquement : jugement rendu

**[C3]** fixe l'exécution en CI seule, faute de moteur de conteneurs sur le Mac
de Franck. Ce choix est confirmé à la livraison : la suite construit l'image
réelle, démarre PostgreSQL et une doublure des services externes, pilote un
vrai Chromium avec une caméra simulée — rien de tout cela n'a d'équivalent
praticable sans Docker. En échange, le job publie le rapport Playwright, les
captures et les vidéos de chaque échec en artefact (**[C14]**) : c'est la seule
trace que Franck pourra inspecter, et elle est jugée suffisante pour ce
compromis.

## Deux limites assumées

**La conservation d'une recette trouvée sur le web n'est pas jouée bout en
bout [C15].** Le récupérateur de pages refuse délibérément le HTTP et toute
adresse privée ou de bouclage — un garde-fou, puisqu'il suit une URL choisie
par un modèle sur une machine du réseau domestique. Une doublure locale tombe
dans les deux cas à la fois ; l'assouplir pour le test reviendrait à tester
l'application avec ce garde-fou désarmé, donc à ne pas le tester du tout. Le
parcours P5 conserve une recette **composée par l'IA**, qui ne déclenche
aucune récupération de page ; l'extraction elle-même reste couverte par les
tests d'intégration, sur cinq formes de pages réelles depuis des fixtures.

**Des parts de P2, P3 et P4 ne sont pas couvertes parce que les
fonctionnalités correspondantes n'existent pas encore [C1] :**

- P2 (rangement des courses) : la saisie et la lecture de la DLC au tiroir de
  scan n'existent pas (demandées, reportées deux fois — voir `CLAUDE.md`,
  section « Prochaine étape »).
- P3 (consommation) : le basculement en liste de courses au seuil ne peut pas
  être joué, ni seuils ni liste n'existant (EF-24, lot 2).
- P4 (consultation) : la vue « à racheter » dépend de cette même liste de
  courses et n'est donc pas jouée non plus.

Chacune de ces lignes devient un parcours le jour où la fonctionnalité livrée
le permet : c'est la tâche de l'incrément qui la livre, pas de celui-ci.
