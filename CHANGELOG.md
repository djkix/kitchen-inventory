# Changelog

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
