# GoatHub : image de production (site + serveur temps réel)
# 1) Construction
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY server server
COPY client client
RUN npm run build -w client && npm run build -w server && npm prune --omit=dev

# 2) Exécution : seulement le nécessaire, sans droits d'administrateur
FROM node:22-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
RUN addgroup -S goathub && adduser -S goathub -G goathub && mkdir -p /data && chown goathub:goathub /data && chmod 700 /data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
USER goathub
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/dist/index.js"]
