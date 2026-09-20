# Inventaire alimentaire

Application web auto-hébergée : scan des produits du foyer depuis le téléphone,
suivi des dates de péremption, suggestions de recettes réalisables avec le stock
disponible.

## Démarrage

```bash
cp .env.example .env   # puis renseigner les valeurs
docker compose up -d
```

L'application doit être servie en HTTPS : l'accès à la caméra en dépend.

## Documentation

- `docs/cahier-des-charges.md` — spécification complète, normative
- `CLAUDE.md` — consignes de développement
- `prisma/schema.prisma` — modèle de données
- `tools/test-scan.html` — page de test du scan (étape 0)

## État

Étape 0 validée. Étape 1 (socle) en cours.
