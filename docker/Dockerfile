# syntax=docker/dockerfile:1
#
# Image unique « API + front » (section 9), construite en plusieurs étapes :
# aucune dépendance de build dans l'image finale, utilisateur non root,
# migrations jouées par l'entrypoint avant le démarrage.

# ---------------------------------------------------------------- dépendances
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY prisma ./prisma
RUN npm ci

# ---------------------------------------------------------------- compilation
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN npx prisma generate --schema prisma/schema.prisma \
  && npm run build -w @kitchen/shared \
  && npm run build -w @kitchen/api \
  && npm run build -w @kitchen/web

# ---------------------------------------------------------------- exécution
FROM node:22-alpine AS runtime
ARG APP_VERSION=0.0.0-dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    MEDIA_DIR=/app/media \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/prisma/migrations
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY prisma ./prisma
# Dépendances d'exécution seulement, sans l'espace de travail web (Vite, React…).
RUN npm ci --omit=dev --workspace @kitchen/shared --workspace @kitchen/api \
  && npx prisma generate --schema prisma/schema.prisma \
  && npm cache clean --force

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./web
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh \
  && mkdir -p /app/media \
  && chown -R node:node /app

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
