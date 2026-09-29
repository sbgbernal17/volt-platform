# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@volt/synthetic-charger..."
RUN pnpm --filter @volt/synthetic-charger build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# UID y GID fijos: Kubernetes solo verifica runAsNonRoot con un usuario numérico.
RUN addgroup -S -g 10001 volt && adduser -S -u 10001 -G volt volt
COPY --from=build /repo/apps/synthetic-charger/dist/main.mjs ./main.mjs
USER 10001:10001
EXPOSE 8080
CMD ["node", "main.mjs"]
