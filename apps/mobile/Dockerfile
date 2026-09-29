# syntax=docker/dockerfile:1.7
# Versión web de la app Volt (Expo Router exportado con Metro) servida por nginx.
FROM node:22-alpine AS build
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL CI=1 EXPO_NO_TELEMETRY=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@volt/mobile..."
RUN pnpm --filter @volt/mobile export:web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/mobile/dist /usr/share/nginx/html
COPY apps/mobile/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
