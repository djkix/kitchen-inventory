# Connexion par compte Google, sans mot de passe

**Date** : 2026-10-18
**Demande de djkix** : « pour la connexion (compte de l'application), je veux
utiliser des adresses mail Google. Il me faut la possibilité de m'enregistrer
ou de me loguer via une adresse gmail (plus de mdp). »
**Exigences touchées** : section 10 du cahier des charges (sécurité).

## Ce qui existe

`apps/api/src/auth` : sessions par cookie `httpOnly`, mots de passe Argon2id,
verrouillage après cinq échecs, pas de compte par défaut, premier
administrateur créé à l'installation (`POST /auth/setup`). Aucune inscription
libre : un compte ne peut être créé que par cette installation initiale.

## Le mécanisme repris de magazine-search

djkix a fourni le guide de son autre application
(`connexion-google-guide.md`). Le mécanisme est repris **tel quel**, pour qu'il
n'existe pas deux façons de se connecter à Google dans sa maison logicielle :

- Google Identity Services, flux **jeton d'identité** : pas de redirection
  OAuth, **pas de client secret**, seul le Client ID (public) est nécessaire.
- Le navigateur obtient un jeton signé, le serveur le **vérifie** (signature,
  audience, expiration) puis ouvre **sa propre session** — le cookie existant
  de Kitchen, inchangé, pour que le reste de l'application n'ait aucune
  différence à gérer.
- Rattachement par **adresse e-mail**, pas par `sub` : c'est ce qui fait
  fusionner le compte existant de djkix avec sa connexion Google, sans
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

Choix de djkix entre quatre options (2026-10-18) : validation par
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
de djkix : si la configuration Google casse, si le projet Google est suspendu
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

**D8 — Le compte de djkix est rattaché par son adresse.** Il reste `ADMIN` et
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
