# Changelog

## [0.9.1](https://github.com/djkix/kitchen-inventory/compare/v0.9.0...v0.9.1) (2026-10-05)


### Bug Fixes

* **web:** nommer les cartes de recette pour les lecteurs d'écran (EF-23) ([6d064eb](https://github.com/djkix/kitchen-inventory/commit/6d064ebed0a13cf2f391eb0fc65ed3295e4d1d78))

## [0.9.0](https://github.com/djkix/kitchen-inventory/compare/v0.8.2...v0.9.0) (2026-10-05)


### Features

* **scan:** saisir la DLC directement dans le tiroir de validation (EF-02) ([21f3a01](https://github.com/djkix/kitchen-inventory/commit/21f3a012eaf09a485190740572dbca6e7e6129f3))


### Bug Fixes

* **scan:** type modifiable après la date, cible tactile et attente locale du test (EF-02) ([b05d02b](https://github.com/djkix/kitchen-inventory/commit/b05d02ba581e006c39fda1daca68f5f28586a1e3))

## [0.8.2](https://github.com/djkix/kitchen-inventory/compare/v0.8.1...v0.8.2) (2026-10-05)


### Bug Fixes

* **stock:** rechercher sans tenir compte des accents (EF-11) ([ea1445d](https://github.com/djkix/kitchen-inventory/commit/ea1445db81957dc458808b2384db22c5d9708c65))

## [0.8.1](https://github.com/djkix/kitchen-inventory/compare/v0.8.0...v0.8.1) (2026-10-05)


### Bug Fixes

* **recipes:** « Mes recettes » n'affichait jamais une recette conservée (EF-17) ([ebce7e0](https://github.com/djkix/kitchen-inventory/commit/ebce7e02a8a55b2c66ad8495e41caf0d95d37b75))

## [0.8.0](https://github.com/djkix/kitchen-inventory/compare/v0.7.0...v0.8.0) (2026-10-04)


### Features

* **prisma:** fournées de suggestions et journal d'appels partagé (EF-26) ([d345e66](https://github.com/djkix/kitchen-inventory/commit/d345e66c2a3ec60555f864d1d435e820d54373ee))
* **recipes:** conserver une suggestion, page extraite et réécrite (EF-25, EF-26) ([566ce38](https://github.com/djkix/kitchen-inventory/commit/566ce3841363f8263041f0d26f0fd31091ce83aa))
* **recipes:** fournisseur de suggestions Gemini avec recherche web (EF-26) ([ea212fb](https://github.com/djkix/kitchen-inventory/commit/ea212fbaa11beeae0ed9c1e5e3cac5c3d5362720))
* **recipes:** routes de suggestion de recettes (EF-26) ([9b72937](https://github.com/djkix/kitchen-inventory/commit/9b72937fc8da36afb224f0f2e36fcd122db0482b))
* **recipes:** service de suggestion, rapprochement au stock et cache (EF-26) ([73de7df](https://github.com/djkix/kitchen-inventory/commit/73de7dfe1220b9881f0d8c1b2307e6dceee3296c))
* **shared:** classement des rapprochements d'ingrédients (EF-26) ([c1e6ede](https://github.com/djkix/kitchen-inventory/commit/c1e6edeb2f50d40a105e6f3c0336efd456277255))
* **shared:** schémas Zod des suggestions de recettes (EF-26) ([0c7beee](https://github.com/djkix/kitchen-inventory/commit/0c7beee5b273894940e04107b88fe823a85c87df))
* **shared:** sélection du point de départ des suggestions (EF-26) ([3ced5ad](https://github.com/djkix/kitchen-inventory/commit/3ced5ad224f31b1ad194bd76928b99b37b44cdd0))
* **web:** écran Suggestions de recettes (EF-26) ([8ba454e](https://github.com/djkix/kitchen-inventory/commit/8ba454e04873086f0cea794dc9a987bbef028919))
* **web:** fiche de suggestion et conservation en bibliothèque (EF-26) ([c289553](https://github.com/djkix/kitchen-inventory/commit/c289553765b544683577e36e5be5c2f91641c55f))
* **web:** orientation des suggestions par région, durée et facilité (EF-26) ([cbea100](https://github.com/djkix/kitchen-inventory/commit/cbea10000a7adbc7c8949dd55d882f752ae19430))
* **web:** Suggestions devient l'écran d'entrée du module recettes (EF-26) ([e821af0](https://github.com/djkix/kitchen-inventory/commit/e821af03d49fde623da9102a0c98e4d7619df34f))


### Bug Fixes

* **api:** un seul code d'erreur pour un fournisseur d'IA non configuré (EF-26) ([914a721](https://github.com/djkix/kitchen-inventory/commit/914a7210885b9fce6b445c38a3cb08703257c3f2))
* **deploy:** propager le plafond à 5 € et le quota de suggestions à la configuration de déploiement (EF-26) ([97e79e1](https://github.com/djkix/kitchen-inventory/commit/97e79e19141cfd80dbe0c9b9b1ba7b41c95b54ef))
* **recipes:** borner la fournée et distinguer une réponse tronquée (EF-26) ([09b90a6](https://github.com/djkix/kitchen-inventory/commit/09b90a62211702af80b7815669b731510a5ec185))
* **recipes:** dédupliquer avant tout appel payant et distinguer les échecs du réécriveur (EF-26) ([f0d910b](https://github.com/djkix/kitchen-inventory/commit/f0d910ba60ae6f810f9c2df11fbea7f99ed64ff1))
* **recipes:** distinguer deux suggestions composées de même titre (EF-26) ([e14db76](https://github.com/djkix/kitchen-inventory/commit/e14db76ca87ecc2f3a1eac1a1717906631c1d727))
* **recipes:** idempotence, comptage et garde-fous de la conservation (EF-25, EF-26) ([e654db2](https://github.com/djkix/kitchen-inventory/commit/e654db21bb10f7aee39d0bec6bc02180e15c0ce7))
* **recipes:** ingrédient introuvable compté comme manquant et exclusions effectives (EF-26) ([ec70c10](https://github.com/djkix/kitchen-inventory/commit/ec70c10ee058f11b73d4a18f45de6953c390b942))
* **recognition:** avertir au démarrage d'un VISION_MODEL hors table de prix (EF-26) ([aacdd91](https://github.com/djkix/kitchen-inventory/commit/aacdd91bf71c089600021cb639610fcdc1d30e9a))
* **recognition:** les suggestions ne pèsent plus sur les compteurs du scan (EF-26) ([2c032cf](https://github.com/djkix/kitchen-inventory/commit/2c032cf7bdc865b991f860a34ecf6a09579052cb))
* **suggestions:** code d'erreur dédié au stock insuffisant (EF-26) ([4427d95](https://github.com/djkix/kitchen-inventory/commit/4427d95a09d56eec470a8b2d0b0553b23098cdea))
* **suggestions:** garde-fous du lecteur de page de recette (EF-25) ([d2302f6](https://github.com/djkix/kitchen-inventory/commit/d2302f66bc4dcc3af3db88a1ced79b7a1b7c6839))
* **suggestions:** identité d'une suggestion dérivée de son contenu (EF-26) ([fb7841d](https://github.com/djkix/kitchen-inventory/commit/fb7841d8cd856cecde1c8b31e787a71e3e291a2d))
* **suggestions:** refresh ne prend plus la chaîne « false » pour un vrai (EF-26) ([ac2cb4d](https://github.com/djkix/kitchen-inventory/commit/ac2cb4d6bd4aa483939ff63632c1c8ccc22bf54b))
* **suggestions:** une ligne de registre par appel au fournisseur (EF-26) ([9521576](https://github.com/djkix/kitchen-inventory/commit/9521576aa4f7cafa3833986b9fbc91adee76a032))
* **suggestions:** valider le lot recette par recette, sans perdre la fournée (EF-26) ([62965b5](https://github.com/djkix/kitchen-inventory/commit/62965b5e6e852518e03ec08bd3dbe75e270daa19))
* **web:** accorder le code et les commentaires du tiroir de conservation (EF-25) ([7368098](https://github.com/djkix/kitchen-inventory/commit/73680981ef1084eb0bbdb0ff78cd3f712330a58c))
* **web:** dire la vérité quand le fournisseur manque ou que le plafond est atteint (EF-26) ([375fb5e](https://github.com/djkix/kitchen-inventory/commit/375fb5e528c3ec7b01796987cca512e0392f3fb8))
* **web:** identifiant de conservation déterministe, stable d'une tentative à l'autre (EF-26) ([e1d7eed](https://github.com/djkix/kitchen-inventory/commit/e1d7eed414d1fb55c0ce869b74f0811f175e916e))
* **web:** rétablir l'écran bloquant du scan quand aucun fournisseur n'est configuré (EF-03) ([8457c3e](https://github.com/djkix/kitchen-inventory/commit/8457c3ec269ee84cbd9253b1959b30ce31bbe2e3))

## [0.7.0](https://github.com/djkix/kitchen-inventory/compare/v0.6.1...v0.7.0) (2026-10-04)


### Features

* **prisma:** schéma du module recettes, notation par membre et archivage (EF-28) ([af0b2d0](https://github.com/djkix/kitchen-inventory/commit/af0b2d0ac659d0c7be3e8d3ce8338ccabe46d0ca))
* **recipes:** création, modification, suppression et archivage des recettes (EF-17, EF-21) ([c94b14d](https://github.com/djkix/kitchen-inventory/commit/c94b14d28200e3e73f227eb093078df8c0a3259b))
* **recipes:** cuisines sans doublon et filtres mémorisés par utilisateur (EF-22) ([5355cde](https://github.com/djkix/kitchen-inventory/commit/5355cde5f57f5a9f4ab0562fcda48c287b529236))
* **recipes:** cuisson avec décrément au prorata des portions (EF-18) ([4788531](https://github.com/djkix/kitchen-inventory/commit/4788531ece552617bf27203dd667e8d4921b9bfc))
* **recipes:** historique des réalisations et notation par membre (EF-28) ([15b3a7a](https://github.com/djkix/kitchen-inventory/commit/15b3a7a58b4161271d45dc106b6d1a3e88816a64))
* **recipes:** liste triée, couverture et indicateurs d'historique (EF-17, EF-23, EF-27) ([06ab9a6](https://github.com/djkix/kitchen-inventory/commit/06ab9a60726ca05bca92011e9d273737713ed36d))
* **recipes:** rappel de notation des réalisations récentes (EF-28) ([4d8e532](https://github.com/djkix/kitchen-inventory/commit/4d8e5321c75a1da2e72ae5a3a4738735a526535d))
* **shared:** difficulté calculée, techniques par mots entiers (EF-21) ([f31794d](https://github.com/djkix/kitchen-inventory/commit/f31794d733c0df34b301b0117fcc2616d8e59939))
* **shared:** disponibilité et couverture des recettes (EF-17, EF-23, EF-27) ([d81ed98](https://github.com/djkix/kitchen-inventory/commit/d81ed988e8111a8e02d684a1a5833221b78b516b))
* **shared:** indicateurs d'historique et étiquettes de recette (EF-28) ([e6a05d0](https://github.com/djkix/kitchen-inventory/commit/e6a05d003f75b1401b11e62d0bda9f3745c3bc9f))
* **shared:** les cinq tris de la liste de recettes (EF-23, EF-27, EF-28) ([1f4da6d](https://github.com/djkix/kitchen-inventory/commit/1f4da6d15d3bc2f0f7a1ddf077d123ddd51fb030))
* **shared:** schémas Zod du module recettes (EF-17, EF-21, EF-22) ([2d7f792](https://github.com/djkix/kitchen-inventory/commit/2d7f792f7e23fbe8129796536b95d1d282de451a))
* **web:** écran Recettes, filtres et tris persistants (EF-21, EF-22, EF-23) ([fb4d63c](https://github.com/djkix/kitchen-inventory/commit/fb4d63cbc9d6f658afd08eac8cdc966b925dc387))
* **web:** fiche recette, états des ingrédients et historique (EF-23, EF-28) ([936c2cc](https://github.com/djkix/kitchen-inventory/commit/936c2cc2fdaa014aa35953d5b3dcaf65f24b389e))
* **web:** saisie et modification d'une recette (EF-17) ([18ec2aa](https://github.com/djkix/kitchen-inventory/commit/18ec2aac4ec2b00a0ae33b9b88953d788f241de1))
* **web:** tiroir de cuisson avec choix du produit et note (EF-18, EF-28) ([f393ead](https://github.com/djkix/kitchen-inventory/commit/f393ead082e718e2431553b40822fb3678735a91))


### Bug Fixes

* **api,web:** décrémenter aussi une ligne catégorie non substituable (EF-18) ([24d95f5](https://github.com/djkix/kitchen-inventory/commit/24d95f55e6d55e0e283fd163eb79300d7d579dab))
* **api:** lots périmés et fusion ignorés à la cuisson, idempotence et archivage (EF-18) ([e1fcdda](https://github.com/djkix/kitchen-inventory/commit/e1fcdda5e74480da0526adb2f2e492a142689181))
* **api:** normaliser la recherche de titre de recette comme ailleurs (A22) ([31b1b1f](https://github.com/djkix/kitchen-inventory/commit/31b1b1fd97729930ba3e5e01963e7db5d965b14a))
* **api:** sortir les aides de test du périmètre de compilation ([4ece3a0](https://github.com/djkix/kitchen-inventory/commit/4ece3a06988c19f3662876548dd73f1ff4bcf034))
* **recipes:** enveloppe de réponse et requête indexée pour le rappel de notation (EF-28) ([fcfc839](https://github.com/djkix/kitchen-inventory/commit/fcfc8397204c8504cc79bbd71952b8a2a083f6d7))
* **recipes:** filet contre la course sur la création d'une cuisine (EF-22) ([e068102](https://github.com/djkix/kitchen-inventory/commit/e06810257fd1ae197a281de59ba5ecf28a70a2b4))
* **recipes:** pont de contenance partagé et unité cohérente du décrément (EF-18) ([8141605](https://github.com/djkix/kitchen-inventory/commit/814160500f9b4ec792e4f95a7b7644d125467e65))
* **recipes:** remonter l'incertitude des lots non convertibles dans la couverture (EF-23) ([c580f19](https://github.com/djkix/kitchen-inventory/commit/c580f19b27df0e1f55543dba4d8e9ce3de50a479))
* **recipes:** sortir la lecture des réglages de la transaction de cuisson et cibler le rejeu (EF-18) ([bf1d003](https://github.com/djkix/kitchen-inventory/commit/bf1d003bdc41d3c9f6df489595b368989a5f27fe))
* **recipes:** unifier la normalisation des cuisines entre amorçage et API (EF-22) ([235b6bd](https://github.com/djkix/kitchen-inventory/commit/235b6bdb28ab99c98ec375f8a8d3613c05ba68d9))
* **seed:** éviter qu’un produit n’ait que des lots périmés (section 19) ([7e859eb](https://github.com/djkix/kitchen-inventory/commit/7e859ebdf8ed72aaa5e9f9ec739c621c941ee850))
* **shared:** catégorie résolue par l'appelant pour un substituable (EF-17, EF-23) ([8cde8df](https://github.com/djkix/kitchen-inventory/commit/8cde8dff42e58cf57fe746aed80c8b9ad04e3fe8))
* **shared:** sentinelle explicite pour leastRecent, stabilité testée sur les cinq tris (EF-23, EF-27, EF-28) ([69024e8](https://github.com/djkix/kitchen-inventory/commit/69024e84634e45782627b8112809dad2fd2f07ad))
* **web:** aligner les pastilles de filtre sur la cible tactile du projet (EF-23) ([4040d69](https://github.com/djkix/kitchen-inventory/commit/4040d6969c5611867ff7204eebcb938cd5d8f525))
* **web:** rendre le groupe d'étoiles navigable au clavier (EF-28) ([a13f5cb](https://github.com/djkix/kitchen-inventory/commit/a13f5cb044563ca63ec9cd8d6896277f9652747c))
* **web:** rendre visible la raison du bouton Modifier désactivé (EF-23) ([d2cee89](https://github.com/djkix/kitchen-inventory/commit/d2cee892317a52a5fde725371742a0df1d0e6ce7))
* **web:** transmettre le temps de préparation au calcul de difficulté (EF-17) ([c8cf205](https://github.com/djkix/kitchen-inventory/commit/c8cf20573c26c3134347751be8524e22d5ba03ce))

## [0.6.1](https://github.com/djkix/kitchen-inventory/compare/v0.6.0...v0.6.1) (2026-10-03)


### Bug Fixes

* **ci:** « latest » ne suit que les versions publiées ([02c735d](https://github.com/djkix/kitchen-inventory/commit/02c735dc8266c88fb4b988e1691e7abeb9481172))

## [0.6.0](https://github.com/djkix/kitchen-inventory/compare/v0.5.0...v0.6.0) (2026-10-03)


### Features

* **web:** bandeau de mise à jour quand une nouvelle version est déployée ([57bc8ce](https://github.com/djkix/kitchen-inventory/commit/57bc8ce199ea343f42c715a31a9820ce3a901393))

## [0.5.0](https://github.com/djkix/kitchen-inventory/compare/v0.4.0...v0.5.0) (2026-09-21)


### Features

* **web:** afficher la version en service sur chaque écran ([a6cb5a6](https://github.com/djkix/kitchen-inventory/commit/a6cb5a6de108434bc19ad1d189113d732156d35a))

## [0.4.0](https://github.com/djkix/kitchen-inventory/compare/v0.3.0...v0.4.0) (2026-09-21)


### Features

* **scan:** photo par l'appareil natif et plafond de dépense mensuel (EF-03) ([c370cac](https://github.com/djkix/kitchen-inventory/commit/c370cac731f8a32f44cb148c33942a96a469cdca))

## [0.3.0](https://github.com/djkix/kitchen-inventory/compare/v0.2.2...v0.3.0) (2026-09-21)


### Features

* **scan:** valider le produit et la quantité avant l'ajout (EF-01, EF-07) ([194ee0b](https://github.com/djkix/kitchen-inventory/commit/194ee0b450e71e113739d61434c62d48993e546a))

## [0.2.2](https://github.com/djkix/kitchen-inventory/compare/v0.2.1...v0.2.2) (2026-09-21)


### Bug Fixes

* **docker:** droits du volume média ajustés au démarrage ([535c0be](https://github.com/djkix/kitchen-inventory/commit/535c0be39824763a04215d1599b8012b9ddcd4c0))

## [0.2.1](https://github.com/djkix/kitchen-inventory/compare/v0.2.0...v0.2.1) (2026-09-21)


### Bug Fixes

* **api:** variables d'environnement vides traitées comme absentes ([898ac46](https://github.com/djkix/kitchen-inventory/commit/898ac4683f3d46fcdbedec98e35a9db5c43cbbc9))

## [0.2.0](https://github.com/djkix/kitchen-inventory/compare/v0.1.0...v0.2.0) (2026-09-21)


### Features

* **scan:** fournisseur de vision Gemini, retenu par défaut (EF-03, EF-04) ([dd295ed](https://github.com/djkix/kitchen-inventory/commit/dd295ed0ebbc36f0500d65c39e2b88949d3aeaa2))

## 0.1.0 (2026-09-21)


### Features

* **api:** données initiales, export et service du front (EF-16) ([9b9e653](https://github.com/djkix/kitchen-inventory/commit/9b9e653f8e88ef538522ac8cf6275096a899aec3))
* **api:** socle NestJS, erreurs normalisées et healthcheck ([044650c](https://github.com/djkix/kitchen-inventory/commit/044650c4bbde49dca8352c11a75935b9db504b09))
* **auth:** comptes locaux, sessions cookie, premier administrateur (EF-13) ([72e2a1d](https://github.com/djkix/kitchen-inventory/commit/72e2a1d0bd1c1893d8b41ffbae04614ddb963480))
* **locations:** emplacements imbriqués à profondeur libre (EF-06) ([8d79d14](https://github.com/djkix/kitchen-inventory/commit/8d79d14b47c114d4b3f968d52059929a590cb0cd))
* **prisma:** migration initiale du schéma (lots 1 et 2) ([9dd3eec](https://github.com/djkix/kitchen-inventory/commit/9dd3eec59e6b6a6ad87f19bf435d0cc37d23cdf8))
* **products:** référentiel, recherche pg_trgm et fusion (EF-05, EF-11, EF-14) ([e8dfffe](https://github.com/djkix/kitchen-inventory/commit/e8dfffe00401990449b6b04d150ee73725591a99))
* **scan:** cascade de reconnaissance et fournisseurs de vision (EF-01, EF-02, EF-03, EF-04, EF-14) ([f2bcda7](https://github.com/djkix/kitchen-inventory/commit/f2bcda724ec771b34046502dfc02d9f3fd1e9120))
* **shared:** règles métier de stock et de dates (EF-07, EF-08, EF-10) ([370a231](https://github.com/djkix/kitchen-inventory/commit/370a2313a77af10092d79427f9cfafa278955d91))
* **shared:** schémas Zod, constantes et synonymes (EF-11) ([8659fd1](https://github.com/djkix/kitchen-inventory/commit/8659fd1ad5d54b474e1cc4a91044c8f3f608c7c0))
* **shared:** unités et conversions (EF-07) ([9c10463](https://github.com/djkix/kitchen-inventory/commit/9c10463329cc1fab933c064876767ed879eb289e))
* **stock:** lots, mouvements autoritaires et péremption (EF-07, EF-08, EF-09, EF-10) ([13245c9](https://github.com/djkix/kitchen-inventory/commit/13245c914df67d96a47b735b5e897d65e036474b))
* **web:** coque PWA, authentification et installation (EF-13) ([be86f96](https://github.com/djkix/kitchen-inventory/commit/be86f9655ac62a9f210267e7139c7a930112237e))
* **web:** écrans Stock, Fiche article et Périme bientôt (EF-07, EF-09, EF-10) ([732b30e](https://github.com/djkix/kitchen-inventory/commit/732b30ee7d784af5d18ad5b793c11bcc2fd893bd))
* **web:** réglages, emplacements, utilisateurs et compteurs (EF-06, EF-09, EF-13, EF-16) ([e125c9a](https://github.com/djkix/kitchen-inventory/commit/e125c9acba5a9f127c412e90875590d11c0b8eb5))
* **web:** scan continu, reconnaissance photo et saisie rapide (EF-01, EF-03, EF-05, EF-06, EF-08) ([95fb89c](https://github.com/djkix/kitchen-inventory/commit/95fb89ca1eb05fc873089550a495d2c3f38996b6))


### Bug Fixes

* **web:** lisibilité du scan sans caméra et de la fiche article ([bd95490](https://github.com/djkix/kitchen-inventory/commit/bd954908adb48170b53c3de5f349d3d279def8bc))


### Miscellaneous Chores

* première version 0.1.0 du lot 1 ([cfa6ea5](https://github.com/djkix/kitchen-inventory/commit/cfa6ea5e56e3887084c2ff485ef85e4abbb71979))
