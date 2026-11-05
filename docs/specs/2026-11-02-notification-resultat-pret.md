# Notification « votre réponse est prête »

Conception du 2026-11-02. Demandée par le propriétaire le 2026-11-02, à la suite d'une
demande parlée refusée pour cause de pause Gemini.

## L'intention

Une demande au modèle met souvent plus de dix secondes : la lecture d'un
ticket, une demande parlée, une fournée de suggestions. Passé cinq à sept
secondes, le propriétaire pose son téléphone et passe à autre chose. Rien ne le rappelle
ensuite : il faut qu'il repense à l'application, la rouvre, et espère que la
requête n'a pas été coupée entre-temps.

Ce qui est demandé : **une notification du téléphone au moment où la réponse
est prête**, celle qui s'affiche application fermée. Et, derrière, la garantie
qui la rend utile — que le traitement aille au bout même quand on a quitté
l'écran, et que le résultat attende au retour.

Mot du propriétaire, le 2026-11-02 : « je fais ma demande, et si je n'ai pas la
réponse sous 5 sec / 7 sec, j'ai envie de faire autre chose, poser mon
téléphone, aller sur une autre application ». Et sur le périmètre : « tout ce
qui demande une attente à +10 sec ».

## Buts

1. Le traitement d'une demande au modèle va au bout indépendamment de l'écran
   qui l'a lancée. Un téléphone verrouillé, une application quittée, un onglet
   gelé par le système ne perdent plus le travail — ni le temps, ni l'argent
   déjà dépensés chez Google.
2. Le résultat est annoncé par une notification du système quand, et seulement
   quand, l'utilisateur n'était plus devant l'écran au moment où il est arrivé.
3. La notification ramène sur le résultat en un geste.
4. Une demande refusée pour une pause Gemini de courte durée est rejouée toute
   seule à la reprise, et c'est le résultat — pas le refus — qui est annoncé.
   Toujours, même si l'on n'a pas quitté l'écran.

## Non-buts

- **Pas d'alertes de péremption.** Elles sont au lot 2 (EF-16) et relèvent
  d'un tout autre déclencheur. Ce chantier pose les tuyaux dont elles se
  serviront ; il ne les livre pas.
- **Pas de courriel, pas de SMS.** Notification du navigateur uniquement.
- **Pas de notification quand l'utilisateur est resté devant l'écran.** Le
  résultat s'affiche comme aujourd'hui, et rien ne sonne.
- **Pas de file de tâches générale.** Rien de ce qui est posé ici ne doit se
  transformer en ordonnanceur maison : c'est la demande au modèle qui est
  rendue reprenable, pas le serveur qui devient un gestionnaire de travaux.
- **Pas de réglage par écran.** Une seule règle, la même pour les quatre
  usages.

## Contre-but

Réveiller quelqu'un du foyer. Une notification qui arrive neuf heures
après la demande, la nuit, pour une recette qu'on ne fera plus, est un échec même si
tout le reste fonctionne. Mieux vaut abandonner la demande et le dire.

## Ce qui existe déjà

- `GeminiService.call` est le point de passage unique des quatre usages
  (demande parlée, suggestions, photo d'article, ticket de caisse). Il choisit
  le modèle, vérifie les quotas avant l'appel, bascule, et lève
  `GeminiPausedError` / `GeminiQuotaError` avec l'heure de reprise.
- `MediaService.save` écrit sur le volume `media` et rend un chemin relatif ;
  le volume est sauvegardé chaque nuit vers le NAS par liens physiques.
- La PWA est servie par `vite-plugin-pwa` en mode `generateSW`, avec
  `registerType: 'prompt'` et `injectRegister: false` ; l'enregistrement est
  fait à la main dans `apps/web/src/lib/pwa.ts`.
- Les écritures portent déjà un `clientOpId` unique (idempotence, préparée
  pour le mode hors ligne).
- L'authentification est par session ; `SessionService.authenticate` vérifie le
  statut du compte à chaque requête.

## La forme retenue

### Le déclencheur : « j'ai posé mon téléphone », pas « dix secondes »

Les dix secondes du propriétaire décrivent une gêne, pas une règle. La règle
littérale — notifier toute demande dépassant dix secondes — se trompe dans les
deux sens : elle sonne alors qu'il regardait l'écran, et elle se tait quand il
est parti au bout de huit.

Le signal juste est l'écran quitté. La page sait qu'elle passe en arrière-plan
(`visibilitychange`), et elle peut le dire au serveur avant d'être gelée
(`navigator.sendBeacon`). Le serveur note alors que cette demande-là devra
être annoncée.

Donc : **une demande est annoncée si la page a signalé son départ pendant que
la demande était en cours, ou si la connexion a été coupée avant la réponse.**
Sinon, rien. Aucun seuil de durée n'apparaît dans le code.

**Une exception, et une seule : la demande différée annonce toujours.** Quand
Gemini est en pause, la demande n'aboutira pas avant plusieurs minutes, et à ce
moment-là personne n'est resté devant l'écran. La règle du départ de page ne
s'y applique donc pas : dès qu'une demande est différée, son aboutissement — ou
son abandon — est annoncé, que l'écran ait été quitté ou non. (Décision de
Le propriétaire, 2026-11-02.) L'écran, lui, cesse d'afficher un refus sec : il dit que la
demande est en attente et qu'elle sera annoncée.

### Le résultat survit à l'écran

Chaque appel au modèle lancé depuis un écran ouvre une ligne `AiRequest` avant
de partir chez Google, et y écrit son résultat en arrivant. La réponse HTTP
reste synchrone : dans le cas courant, l'écran reçoit son résultat comme
aujourd'hui, et la ligne n'aura servi à rien. Si la connexion est tombée, le
traitement continue côté serveur, écrit son résultat, et la ligne devient le
seul chemin vers lui.

Au retour, l'écran réclame le résultat par son `clientOpId` — déjà en place —
et le trouve.

### Les demandes différées

Quand `GeminiService` refuse l'appel pour une pause commune, la demande n'est
plus perdue : son entrée est conservée et rejouée à l'heure de reprise
annoncée. Deux bornes :

- **Une heure au plus.** Au-delà, la demande est abandonnée et l'abandon est
  annoncé — c'est le contre-but qui commande. Le 429 qui vise le projet
  annonce quelques minutes, une heure au pire ; le quota du jour, lui, ne mène
  plus ici, puisqu'il fait basculer de modèle (amendement du 2026-11-02 à
  l'approche Gemini).
- **L'entrée est effacée dès que la demande aboutit ou est abandonnée.**

### Ce que la notification dit

Un titre qui nomme ce qui est prêt et un corps qui donne la substance, pour
qu'on puisse décider sans ouvrir : « 6 idées de recettes » plutôt que
« Traitement terminé ». Le clic ouvre l'écran concerné, sur le résultat.

Une seule notification par demande ; elle remplace la précédente si la même
demande en produit une autre (`tag`).

## Les décisions

| # | Décision |
| --- | --- |
| D1 | **Le déclencheur est l'écran quitté, pas une durée.** Détaillé ci-dessus. Aucun seuil en secondes dans le code. |
| D1b | **Une demande différée annonce toujours**, écran quitté ou non, à son aboutissement comme à son abandon — sans quoi le but 4 serait vide de sens pour qui attend devant l'écran. L'écran affiche l'attente, et non plus un refus. Décision du propriétaire, 2026-11-02. |
| D2 | **La réponse HTTP reste synchrone.** Les quatre points d'entrée gardent leur forme : requête, attente, résultat. Rien ne devient « 202 + sondage », parce que le cas courant — une réponse en huit secondes, écran allumé — n'a rien à y gagner et que les quatre écrans auraient tous à être réécrits. |
| D3 | **Une table `AiRequest`, pas une file de tâches.** Une ligne par demande au modèle : utilisateur, usage, `clientOpId`, état, entrée conservée le cas échéant, résultat, erreur, horodatages, `notifyAt`. Pas d'ordonnanceur générique. |
| D4 | **Le résultat est récupéré par un identifiant engendré par le client**, envoyé avec la demande et repris comme identité de la ligne `AiRequest`. *(Correction : contrairement à ce que cette conception affirmait d'abord, `clientOpId` n'existe aujourd'hui que sur `StockMovement` et `RecipeLog` ; aucun des quatre points d'entrée IA n'en reçoit. La convention est donc à étendre, pas à réutiliser telle quelle, et `GET /suggestions` devra porter cet identifiant bien qu'il soit une lecture.)* La PWA garde l'identifiant des demandes qu'elle n'a pas vues aboutir et les réclame au retour. |
| D5 | **L'audio d'une demande différée est conservé — amendement à D6 de la demande parlée.** Rejouer la demande à la reprise suppose de la garder. L'enregistrement est écrit sous un préfixe dédié, effacé dès que la demande aboutit ou est abandonnée, et jamais versé au journal des appels. Le cas courant — demande qui part tout de suite — ne conserve toujours rien. Décision du propriétaire, 2026-11-02, en connaissance de la conséquence. |
| D6 | **Une heure de différé au plus**, puis abandon annoncé. |
| D7 | **Web Push, abonnement par appareil.** Clés VAPID dans la configuration du serveur, abonnements en base avec leur utilisateur. Un abonnement refusé par le service de push (404, 410) est supprimé. |
| D8 | **L'autorisation est demandée depuis Réglages**, par un interrupteur « Me prévenir quand une réponse est prête », et non au moment où l'on quitte l'écran — la page y est en train de geler, et une demande d'autorisation surgie à ce moment serait refusée par réflexe. L'interrupteur vaut pour l'appareil où l'on est, et le dit. |
| D9 | **La règle « faut-il annoncer ? » est une fonction pure de `packages/shared`**, testée, partagée. Elle ne vit ni dans un contrôleur ni dans un composant (règle du projet, section 15). |
| D10 | **Le service worker passe en `injectManifest`.** Recevoir un `push` suppose un service worker écrit à la main ; `generateSW` ne le permet pas. Le comportement actuel — mise à jour proposée par bandeau, jamais appliquée d'autorité — doit être reconduit à l'identique, c'est une exigence, pas un détail d'implémentation. |
| D12 | **Un redémarrage n'essaie pas de sauver une demande en cours.** Seules les demandes **différées** survivent au redémarrage, comme annoncé : leur entrée est en base. Une ligne restée « en cours » au démarrage est close en échec, et annoncée comme telle si la page avait été quittée. Conserver l'entrée de *toute* demande pour pouvoir la rejouer étendrait D5 à chaque photo et chaque ticket, pour un gain — survivre à un redémarrage du conteneur, qui n'arrive qu'aux mises à jour — sans rapport avec ce qui est demandé. *Arbitrage du rédacteur.* |
| D13 | **Au rejeu, quota journalier et plafond mensuel sont revérifiés.** Une demande différée n'a rien consommé ; une heure plus tard, l'autre membre du foyer a pu épuiser le quota. Épuisé au rejeu : la demande est abandonnée et l'abandon annoncé, avec sa raison. Pas de nouveau différé — le quota du jour ne se rouvre qu'à minuit du Pacifique, bien au-delà du plafond de D6. *Arbitrage du rédacteur.* |
| D14 | **La notification part sur tous les appareils abonnés de cet utilisateur**, et sur eux seuls — jamais sur ceux de l'autre membre du foyer. Viser le seul appareil d'origine demanderait de rattacher la demande à la session, pour éviter un inconvénient qui n'existe que si l'on s'abonne depuis deux appareils ; le `tag` commun fait qu'on ne voit qu'une notification par demande là où on la lit. *Arbitrage du rédacteur, à revoir si l'usage le dément.* |
| D15 | **Une nouvelle demande remplace la demande différée du même utilisateur pour le même usage.** Sans cela, réappuyer après un refus fait deux appels payés et deux notifications pour une seule intention. L'ancienne est abandonnée sans notification et son entrée effacée. *Arbitrage du rédacteur.* |
| D11 | **Rien de tout cela n'est requis pour que l'application marche.** Sans clés VAPID configurées, sans autorisation accordée, ou sur un appareil qui ne sait pas faire, tout continue comme aujourd'hui : la demande part, le résultat s'affiche, et l'interrupteur de Réglages dit pourquoi il est éteint. |

## Contraintes

- **L'hébergement est le sien.** Pas de service tiers de notification à
  souscrire : Web Push s'adresse directement aux serveurs de push des
  navigateurs, avec des clés VAPID engendrées une fois et rangées dans la
  configuration. La procédure a sa place dans le README.
- **iOS.** Web Push n'y fonctionne que si la PWA est installée sur l'écran
  d'accueil. À dire dans l'interface plutôt qu'à découvrir.
- **Le volume `media` part au NAS chaque nuit.** Les entrées différées, qui y
  séjournent au plus une heure, ne doivent pas s'y accumuler ; leur purge est
  une exigence, pas un nettoyage optionnel.
- **Migration Prisma versionnée** pour les deux tables, comme toute
  modification de schéma.
- **Aucun test ne dépend du réseau.** Le service de push est doublé, comme
  Gemini et Open Food Facts le sont déjà.
- **Français pour l'interface et les notifications, anglais pour le code.**

## Laissé au constructeur

- Le découpage en modules NestJS, les noms de tables et de colonnes, la forme
  exacte des points d'entrée.
- Le mécanisme de reprise des demandes différées — minuterie, intervalle,
  reprise au démarrage — pourvu qu'un redémarrage du conteneur ne perde pas
  une demande en attente et qu'une demande ne soit jamais jouée deux fois.
- La bibliothèque de Web Push côté serveur.
- Le texte exact de chaque notification, dans l'esprit donné plus haut.
- La place de l'interrupteur dans Réglages.
- S'il faut, ou non, un parcours bout en bout : la décision appartient à celui
  qui aura vu ce que les tests existants couvrent déjà.

## Ce que ça touche

`prisma/schema.prisma` et une migration ; un module d'API pour les demandes et
un pour les abonnements ; `GeminiService` et les quatre fournisseurs, pour que
le refus différé remonte proprement ; `packages/shared` pour la règle pure et
les schémas Zod ; `apps/web` pour le service worker, le signal de départ de
page, la récupération au retour et l'interrupteur de Réglages ; le README et
le cahier des charges (section 26).
