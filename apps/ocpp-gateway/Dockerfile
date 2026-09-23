# syntax=docker/dockerfile:1.7
# Construye el gateway OCPP como un único bundle ESM y lo ejecuta con Node 22 sin dependencias de desarrollo.
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@volt/ocpp-gateway..."
RUN pnpm --filter @volt/ocpp-gateway build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S volt && adduser -S volt -G volt
COPY --from=build /repo/apps/ocpp-gateway/dist/main.mjs ./main.mjs
USER volt
EXPOSE 9220 9221
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:9221/healthz || exit 1
CMD ["node", "main.mjs"]
