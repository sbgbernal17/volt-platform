# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @volt/worker build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S volt && adduser -S volt -G volt
COPY --from=build /repo/apps/worker/dist/main.mjs ./main.mjs
USER volt
CMD ["node", "main.mjs"]
