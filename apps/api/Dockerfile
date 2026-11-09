# syntax=docker/dockerfile:1
# Contexto de build: raíz del monorepo  (docker build -f apps/api/Dockerfile .)
FROM node:22-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN npm ci -w @conexa/api --include-workspace-root=false
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
RUN npm run build -w @conexa/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=builder /repo/package.json /repo/package-lock.json ./
COPY --from=builder /repo/apps/api/package.json apps/api/
COPY --from=builder /repo/packages/shared/package.json packages/shared/
COPY --from=builder /repo/packages/db/package.json packages/db/
RUN npm ci -w @conexa/api --omit=dev --include-workspace-root=false && npm cache clean --force
COPY --from=builder /repo/apps/api/dist apps/api/dist
USER node
EXPOSE 4000
# Same image runs the worker (infra/docker-compose.yml): node apps/api/dist/worker.js
CMD ["node", "apps/api/dist/server.js"]
