# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @volt/backoffice build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/backoffice/dist /usr/share/nginx/html
COPY apps/backoffice/nginx.conf /etc/nginx/templates/default.conf.template
COPY apps/backoffice/docker-entrypoint.sh /docker-entrypoint.d/../volt-entrypoint.sh
RUN rm -f /etc/nginx/conf.d/default.conf && chmod +x /volt-entrypoint.sh
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/volt-entrypoint.sh"]
