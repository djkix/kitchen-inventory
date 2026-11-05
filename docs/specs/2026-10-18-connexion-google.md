# Connexion par compte Google, sans mot de passe

**Date** : 2026-10-18
**Demande du propriétaire** : « pour la connexion (compte de l'application), je veux
utiliser des adresses mail Google. Il me faut la possibilité de m'enregistrer
ou de me loguer via une adresse gmail (plus de mdp). »
**Exigences touchées** : section 10 du cahier des charges (sécurité).

## Ce qui existe

`apps/api/src/auth` : sessions par cookie `httpOnly`, mots de passe Argon2id,
verrouillage après cinq échecs, pas de compte par défaut, premier
administrateur créé à l'installation (`POST /auth/setup`). Aucune inscription
libre : un compte ne peut être créé que par cette installation initiale.

## Le mécanisme repris de magazine-search

Le propriétaire a fourni le guide de son autre application
(`connexion-google-guide.md`). Le mécanisme est repris **tel quel**, pour qu'il
n'existe pas deux façons de se connecter à Google dans sa maison logicielle :

- Google Identity Services, flux **jeton d'identité** : pas de redirection
  OAuth, **pas de client secret**, seul le Client ID (public) est nécessaire.
- Le navigateur obtient un jeton signé, le serveur le **vérifie** (signature,
  audience, expiration) puis ouvre **sa propre session** — le cookie existant
  de Kitchen, inchangé, pour que le reste de l'application n'ait aucune
  différence à gérer.
- Rattachement par **adresse e-mail**, pas par `sub` : c'est ce qui fait
  fusionner le compte existant du propriétaire avec sa connexion Google, sans
  doublon ni perte d'historique.
- `email_verified` obligatoire : Google autorise des comptes à adresse non
  vérifiée, on n'authentifie personne sur une adresse qu'il ne contrôle pas.
- `sub` stocké, nullable, unique, **pour mémoire** : il ne sert pas à
  retrouver l'utilisateur.
- Client ID servi par le serveur **à l'exécution** (`GET /auth/google/client-id`,
  route publique). Le piège n° 1 du guide vaut ici aussi : Vite fige ses
  variables au `build`, et l'image est construite une seule fois par la CI —
  une variable de build serait vide en production et le bouton n'apparaîtrait
  jamais.

## Décisions propres à Kitchen

**D1 — L'inscription est ouverte, mais le compte est inactif jusqu'à
validation par un administrateur.** C'est le seul point où Kitchen diverge du
guide, et c'est le guide lui-même qui le prévoit : « Si l'autre application
doit rester privée, restreindre à une liste d'emails ou à un domaine, ou
exiger une validation admin. » Dans magazine-search, un inconnu qui s'inscrit
voit un moteur de recherche. Ici il verrait le contenu des placards — et la
section 10 du cahier des charges rappelle que l'inventaire alimentaire d'un
foyer révèle des habitudes de consommation et, indirectement, des informations
de santé et de pratique religieuse. L'application est publiée sur Internet
(nécessaire pour scanner en magasin) : l'inscription ouverte y publierait ces
données à qui trouve l'adresse.

Choix du propriétaire entre quatre options (2026-10-18) : validation par
l'administrateur, plutôt qu'une liste d'adresses fixée à l'avance — il peut
ainsi inviter quelqu'un sans connaître son adresse Google au préalable.

**D2 — Un troisième état de compte, pas un booléen de plus.** `User` gagne un
`status` (`PENDING`, `ACTIVE`, `REVOKED`). Une première connexion Google d'une
adresse inconnue crée un compte `PENDING` : le jeton est valide, mais **aucune
session n'est ouverte** et l'écran annonce que la demande attend une
validation. `REVOKED` existe pour couper l'accès sans supprimer le compte, qui
porte de l'historique de réalisations et des notes.

Pourquoi un `status` et non un `active: boolean` : « jamais validé » et
« validé puis révoqué » ne se traitent pas pareil à l'écran, et un booléen
obligerait à deviner lequel des deux on regarde.

**D3 — Aucune session n'est ouverte pour un compte non actif.** La validation
se vérifie **côté serveur, à chaque connexion**, jamais seulement à l'affichage.
Un compte `PENDING` ou `REVOKED` reçoit un refus explicite, et ses sessions
éventuelles sont révoquées au moment où l'administrateur le révoque.

**D4 — Les comptes en attente se gèrent dans Réglages › Comptes**, visible des
seuls administrateurs : la liste des demandes avec adresse, nom et date, deux
actions (valider, refuser), et la liste des comptes actifs avec la possibilité
de révoquer. Un compte refusé passe `REVOKED`, il n'est pas supprimé : sans
cela, la même adresse pourrait redemander indéfiniment sans que rien n'en
garde trace.

**D5 — Le mot de passe disparaît de l'interface.** Plus de formulaire de
connexion par mot de passe, plus de changement de mot de passe, plus
d'installation par mot de passe. `passwordHash` devient **nullable** plutôt que
de recevoir une valeur aléatoire : une colonne qui ment sur son contenu est
pire qu'une colonne vide. Les routes `POST /auth/login` et `POST /me/password`
sont retirées.

**D6 — La porte de secours est une commande serveur, jamais une route.** Choix
du propriétaire : si la configuration Google casse, si le projet Google est suspendu
ou si le domaine change, plus personne n'entre. Un script
(`tools/acces-secours.ts`, lancé depuis Dockge dans le conteneur) crée ou
réactive un administrateur et lui pose un mot de passe à usage unique, valable
une heure, utilisable sur une route de secours qui n'existe **que** si ce mot
de passe temporaire est en base. Rien n'est exposé sur Internet en temps
normal : pas de formulaire, pas de route visible, pas de secret dormant.

**D7 — La première installation change de forme.** `POST /auth/setup` ne crée
plus un administrateur par mot de passe. Sur une base vide, **la première
connexion Google réussie crée l'administrateur**, `ACTIVE` et `ADMIN`, et pose
les emplacements par défaut comme aujourd'hui. Le verrou d'exclusion existant
(`LOCK TABLE … SHARE ROW EXCLUSIVE`) est conservé : deux connexions simultanées
sur une base vide ne doivent créer qu'un seul administrateur.

**D8 — Le compte du propriétaire est rattaché par son adresse.** Il reste `ADMIN` et
`ACTIVE`, garde recettes, historique, notes et préférences. La migration pose
`status = 'ACTIVE'` sur tous les comptes existants : personne n'est enfermé
dehors par la mise à jour.

**D9 — Les protections de la section 10 restent.** La limitation de débit de la
connexion s'applique à `POST /auth/google` comme elle s'appliquait à
`/auth/login`. Le verrouillage après cinq échecs disparaît avec les mots de
passe : il n'a plus d'objet, un jeton Google ne se devine pas par essais
successifs. `failedLogins` et `lockedUntil` sont retirés de `User`.

## Configuration et déploiement

| Variable | Rôle |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Client ID public. Vide = connexion Google indisponible, et le bouton ne s'affiche pas. |

Console Google Cloud, sur le projet `Kitchen` qui sert déjà Gemini : APIs et
services → Identifiants → ID client OAuth → Application web. **Origines
JavaScript autorisées** : l'URL exacte de l'instance, sans chemin ni barre
finale. Pas d'URI de redirection avec ce flux. Écran de consentement en
« Externe » et « Production », sans quoi seuls des testeurs déclarés pourraient
se connecter — c'est la validation par l'administrateur qui ferme la porte,
pas le mode de l'écran de consentement.

**D10 — Amendement du 2026-10-18, après la revue de sécurité.** Trois points
que la première rédaction avait manqués :

- **`PENDING` et `REVOKED` rendent la même réponse.** La spec prévoyait deux
  messages distincts. C'était une erreur : un appelant non authentifié
  distinguait alors trois classes d'adresses, et la seconde confirmait qu'une
  adresse appartient au foyer et en a été écartée.
- **Une discordance de `sub` est un refus, pas un détail.** La spec écarte la
  *recherche* par `sub` — elle n'a jamais demandé d'*ignorer* un `sub` qui ne
  correspond pas à celui déjà enregistré pour cette adresse. Sans ce contrôle,
  une adresse Workspace supprimée puis réattribuée donne à son nouveau
  titulaire le compte de l'ancien, son rôle et tout l'inventaire.
- **Le statut est vérifié à chaque requête**, pas seulement à la connexion.
  Révoquer coupe les sessions en cours (D4), mais une révocation qui ne tient
  qu'à ce geste laisse la porte ouverte trente jours le jour où un chemin
  oublie de le faire.
- **`POST /users` ne crée plus de compte.** Deux façons de créer un compte
  actif, dont une absente de l'écran Comptes, et une faute de frappe dans une
  adresse saisie à la main ouvrait l'inventaire au titulaire réel de cette
  boîte. Avec D1, pré-créer n'a plus d'objet : la personne se connecte, apparaît
  en attente, et l'administrateur valide une adresse **que Google a
  authentifiée**.

**D11 — Amendement du 2026-10-18, après la revue finale du lot.** Quatre
points que la revue a relevés et qui sont tranchés ici :

- **L'administration se partage** (`POST /accounts/:id/role`, réservé aux
  administrateurs). D7 fait du premier connecté l'administrateur et de tous les
  suivants des membres, et D10 a retiré `POST /users` : plus aucun chemin ne
  créait un second administrateur. Conséquences réelles : l'administration ne
  se partageait pas, la garde « dernier administrateur actif » ne pouvait
  jamais être levée, et la commande de secours devenait de fait le seul outil
  de promotion du projet. La route porte les garde-fous du même esprit que la
  révocation : on ne change pas son propre rôle, on ne rétrograde pas le
  dernier administrateur actif (sous le même verrou consultatif), et un compte
  non actif ne change pas de rôle — le promouvoir reviendrait à le valider sans
  le dire. Exposé dans Réglages › Comptes sur la ligne d'un compte actif.

- **Un jeton de service appartient au foyer, pas à une personne.** La revue
  relève qu'un `Bearer kit_…` survit à la révocation de qui l'a créé. C'est
  exact, et c'est le comportement juste : `ServiceToken` n'a jamais porté de
  lien vers `User`, il est créé avec un nom et rien d'autre, et la section 11
  du cahier en fait l'accès en lecture seule d'une **intégration** (Home
  Assistant). Lui inventer un propriétaire ferait porter à l'intégration de la
  maison le sort du compte de celui qui a cliqué : le jour où cette personne
  part, le tableau de bord tombe sans que personne ne comprenne pourquoi. La
  correction est donc de le **dire** — README (« Le premier compte, puis les
  suivants » et « Intégrations ») — et non d'ajouter un lien qui n'existe pas :
  révoquer un compte ne coupe pas les jetons de service, on les supprime dans
  Réglages › Jetons de service, comme on change une serrure.

- **La fenêtre du premier administrateur est nommée.** `GET /auth/status`
  annonce publiquement `setupRequired`, et la première connexion sur une base
  vide crée un `ADMIN`. Aucune garde technique ne ferme cette fenêtre sans
  interdire l'installation elle-même ; elle se ferme par la conduite : se
  connecter **immédiatement** après le premier démarrage, avant d'ouvrir
  l'accès, et de nouveau après toute restauration sur base vide. Dit dans le
  README aux deux endroits (« Déployer » et « Sauvegarde et restauration »).

- **`GOOGLE_CERTS_URL` n'est plus silencieuse.** Elle reste sans garde
  `NODE_ENV` — qui peut poser une variable d'environnement peut déjà lancer la
  commande de secours, la garde n'enlèverait aucune capacité et casserait le
  montage e2e. Mais elle est documentée dans `.env.example` comme réservée aux
  tests, elle émet un avertissement au démarrage
  (`googleCertsOverrideWarning`), et `/health` la rend visible sous
  `google_certs_url` dans `degraded`. Un compromis muet est pire qu'un
  compromis bruyant ; le montage e2e, lui, marche à l'identique.

## Limites assumées

- **Une connexion Google indisponible rend l'application inaccessible** à tous
  sauf par la commande de secours. C'est le prix de « plus de mot de passe »,
  demandé explicitement.
- **Un inconnu peut créer une demande.** Il ne voit rien, mais la liste des
  demandes en attente est un espace où n'importe qui peut écrire un nom. La
  limitation de débit borne le volume ; aucune notification n'est envoyée.
- **Le changement d'adresse Google casse le rattachement** : le compte est
  retrouvé par l'adresse, pas par le `sub`. Une adresse changée crée une
  nouvelle demande, qu'un administrateur valide, et l'ancien compte garde son
  historique. Faire mieux demanderait de retrouver par `sub` en priorité, ce
  que le guide écarte délibérément pour que la fusion par adresse fonctionne.
- **Le script de secours suppose un accès au serveur.** Sans accès à Dockge ni
  au conteneur, il n'y a pas de recours.
- **Un jeton de service survit à la révocation de son créateur** : c'est voulu
  (D11), il appartient au foyer. Le supprimer est le seul geste qui le coupe.
- **La fenêtre du premier administrateur ne se ferme que par la conduite**
  (D11) : aucune garde technique ne la referme sans interdire l'installation.
