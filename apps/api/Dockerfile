# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@volt/api..."
RUN pnpm --filter @volt/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# UID y GID fijos: Kubernetes solo verifica runAsNonRoot con un usuario numérico.
RUN addgroup -S -g 10001 volt && adduser -S -u 10001 -G volt volt
COPY --from=build /repo/apps/api/dist/main.mjs ./main.mjs
# Migraciones (Cloud Run Job `migrate`): el bundle las busca en ../migrations respecto a sí mismo.
COPY --from=build /repo/apps/api/dist/migrate.mjs ./migrate.mjs
COPY --from=build /repo/packages/db/migrations /migrations
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "main.mjs"]
