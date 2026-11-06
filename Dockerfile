FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json vite.config.ts ./
COPY server ./server
COPY shared ./shared
COPY web ./web
COPY scripts/verify-document-formats.mjs scripts/ocr-assets.mjs ./scripts/
COPY data ./data
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node assets/ubl-survey-template.xlsx ./assets/ubl-survey-template.xlsx
COPY --chown=node:node scripts/ubl-survey-xlsx.mjs ./scripts/ubl-survey-xlsx.mjs
USER node
EXPOSE 3000
CMD ["sh", "-c", "node dist/server/db/migrate-cli.js && exec node dist/server/main.js"]
