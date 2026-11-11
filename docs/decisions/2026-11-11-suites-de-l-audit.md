# Suites de l'audit externe du 2026-11-11

L'audit portait sur la `v0.42.0` (commit `6d14332`), à partir de
`docs/2026-11-11-note-de-cadrage-audit.md`. Il a rendu neuf constats de
sécurité, cinq de logique ou de concurrence, deux de stockage et quatre de
robustesse.

Chaque constat a été rejoué dans le code avant d'être traité : le rapport
décrit par endroits un code qui n'existe pas ici (`helmet`, `docker/restore.sh`,
`apps/web/src/offline/queue.ts`, un `productId` sur `RecognitionLog`), et trois
de ses constats tombent avec ces descriptions. Ce qui suit est le verdict
retenu, constat par constat.

## Corrigé

| Constat | Ce qui était vrai | Ce qui a changé |
| --- | --- | --- |
| SEC-01 | `endpoint` d'un abonnement Web Push n'était qu'une URL : le serveur postait où on lui disait, routeur ou base comprise | `isPushEndpoint` (`packages/shared`) exige HTTPS et un nom public ; ni adresse IP littérale, ni `.local`, ni identifiants dans l'adresse |
| SEC-02 | Un jeton de service lisait **toute** l'API en `GET` : export, tickets, médias, journal des réalisations | `SERVICE_TOKEN_PREFIXES` limite le jeton à l'inventaire (`/stock`, `/products`, `/locations`, `/categories`, `/suggestions`, `/health`, `/me`) ; le reste rend 403 |
| SEC-03 | `GET /media/differe/…` servait les entrées gardées pour un rejeu (photo de ticket, enregistrement vocal), et une URL mal encodée levait un 500 | `MediaService.resolvePublic` refuse `differe` après normalisation ; le décodage rate en 404 |
| SEC-04 | Le refus de `POST /auth/recovery` était immédiat sans fenêtre de secours, lent avec : le chronomètre disait qu'une porte venait de s'ouvrir, et pour quelle adresse | Un hachage factice est vérifié quand il n'y a rien à vérifier (`verifyAgainstDecoy`) |
| SEC-04 | `acces-secours` réactivait en administrateur un compte **refusé** portant le compte Google de quelqu'un d'autre | Refus explicite dans ce cas, `--force` pour passer outre. Un compte en attente se promeut toujours sans rien dire : c'est le chemin normal |
| SEC-05 | `umask 022` : le `.env` et le dump copiés sur le NAS étaient lisibles par tout ce qui monte le partage | `umask 077` |
| SEC-06 | `GOOGLE_CERTS_URL` en production n'était qu'un avertissement, alors qu'elle déplace la racine de confiance de l'authentification | L'application **refuse de démarrer** si elle est posée en production sans `ALLOW_GOOGLE_CERTS_OVERRIDE=true` ; le montage de tests bout en bout pose les deux |
| SEC-07 | `flattenJsonLdNodes` récursait sans borne sur le JSON-LD d'une page tierce | La lecture entière d'un bloc est sous `try` : un bloc trop imbriqué est traité comme illisible |
| SEC-07 | Aucun plafond de lignes à la **lecture** d'un ticket (la validation, elle, en avait un) | `RECEIPT_LINES_MAX` (200), partagé par la lecture et la validation |
| SEC-09 | Le service worker ouvrait l'adresse de la notification sans la ramener à l'application | `sameOriginPath` : tout ce qui n'est pas un chemin de l'application ramène à l'accueil |
| LOGIC-01 | Le rejeu d'une consommation qui avait épuisé le lot rendait 422 : la garde « lot épuisé » passait avant la reconnaissance du `clientOpId` — l'idempotence de la file hors ligne était cassée | `findReplay` est consulté **dans** la transaction, avant toute garde, pour `consume` et `adjust` |
| LOGIC-01 | Deux rejeux simultanés du même `clientOpId` rendaient un 500 (`P2002`) | `applyMovement` traite la violation d'unicité comme le succès de l'autre |
| LOGIC-01 | `consume` et `adjust` lisaient la quantité hors transaction : deux écritures concurrentes décidaient sur la même lecture, et la somme des mouvements pouvait passer sous zéro pendant que la quantité matérialisée s'arrêtait à zéro | La ligne est verrouillée (`SELECT … FOR UPDATE`) et relue dans la transaction qui écrit |
| LOGIC-03 | `ProductsService.merge` ne migrait pas `ReceiptLabelAlias` ni `ReceiptLine` : les libellés de tickets appris sur le produit fusionné retombaient en « non reconnu » | Les deux tables suivent la fusion |
| SEC-02 | Chaque requête d'un jeton écrivait `lastUsedAt` | Écrit au plus une fois par heure, comme l'expiration glissante d'une session |

## Écarté, avec sa raison

- **LOGIC-04** (demandes `RUNNING` bloquées 24 h après un redémarrage) :
  faux. `DeferralService.closeOrphans` tourne à l'initialisation du module et
  clôt ces lignes en échec — c'est la décision D12 de la conception du
  2026-11-02, et le code est là.
- **LOGIC-02** (double ajout en stock sur double validation d'un ticket) :
  surévalué. Chaque ligne porte un `clientOpId` et `StockService.create` est
  idempotent ; deux validations concurrentes de la même page n'ajoutent rien
  deux fois. La correction `P2002` ci-dessus couvre le 500 qui pouvait en
  sortir.
- **SEC-08** (l'audio différé écrit sur le disque contredit D6) : ce n'est pas
  une faille mais une contradiction entre deux documents. D6 du 2026-10-21
  disait que l'audio n'est conservé nulle part ; la conception du 2026-11-02 a
  décidé de garder l'entrée d'une demande différée le temps du rejeu, et de
  l'effacer dès qu'elle aboutit ou est abandonnée. C'est le second qui fait
  foi. La fuite réelle de ce dossier — il était servi par HTTP — est corrigée
  sous SEC-03.
- **Vérification des *magic bytes*** sur les téléversements : écartée. Le type
  déclaré est vérifié, la taille est bornée, le fichier n'est jamais exécuté ni
  servi à un tiers, et il finit chez Gemini qui le refuse s'il n'est pas ce
  qu'il prétend.
- **SEC-07, injection de prompt indirecte** depuis une page de recette : réel
  mais inhérent. Le texte d'une page tierce est envoyé au modèle, qui ne peut
  en retour produire qu'une recette validée par schéma, jamais une action. Le
  récupérateur de pages refuse déjà HTTP et les adresses privées. Rien à
  resserrer sans rendre la fonctionnalité inutile.
- **LOGIC-05** (quota du jour consommé sur un délai réseau) : conservatisme
  voulu. Une requête partie a selon toute vraisemblance été comptée par
  Google ; ne pas la compter ici ferait dépasser le quota pour de vrai.
- **ROB-01 à ROB-04** : laissés tels quels. La collision d'identité d'une
  suggestion sur 32 bits dédoublonnerait à tort une recette sur des millions ;
  `trust proxy: 1` est juste pour l'installation réelle, qui a un seul proxy.

## Reporté au lot 2

- **DATA-01** : les photos de scans et de produits ne sont jamais purgées, et
  partent chaque nuit sur le NAS. Croissance lente, pas une faille.
- **DATA-02** : `RecognitionLog` et `GeminiCall` croissent sans politique de
  rétention.

Les deux demandent une décision de rétention (combien de temps, et quoi faire
des photos d'un produit supprimé) qui n'appartient pas à une correction
d'audit.
