FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=node:node server/realtime-server.mjs ./server/realtime-server.mjs

USER node
EXPOSE 8080
CMD ["node", "server/realtime-server.mjs"]
