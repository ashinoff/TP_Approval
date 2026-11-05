FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_PLATFORM_ORIGIN
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY apps ./apps
COPY scripts/setup-standalone.ts scripts/migrate.ts ./scripts/
RUN npm run build
RUN npx tsc -p tsconfig.setup.json
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production AUTH_MODE=local HOST=0.0.0.0 PORT=3000 WEB_PATH=/app/dist/web STORAGE_PATH=/data/storage TRUST_PROXY_HOPS=1 CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=3310
WORKDIR /app
# LibreOffice Draw (без интерфейса) переводит рисунки EMF/WMF схем Visio в PNG для просмотра; шрифты, метрически
# совместимые с Times New Roman/Arial, — чтобы подписи на схемах не «разъезжались».
RUN apt-get update && apt-get install -y --no-install-recommends gosu ca-certificates clamav-daemon clamav-freshclam     libreoffice-draw-nogui fonts-liberation2 fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY infra/clamav-embedded/clamd.conf infra/clamav-embedded/freshclam.conf /etc/clamav/
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY db/migrations ./db/migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod 755 /app/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node","dist/api/server.js"]
