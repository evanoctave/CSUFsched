# Every workspace package is consumed from TypeScript source and run under Node's
# type stripping, so there is no build step to stage — the API, the migrator and
# both scrapers all ship the same installed tree and differ only in entrypoint.
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Manifests first so a source-only change does not reinstall the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY db/package.json db/
COPY packages/types/package.json packages/types/
COPY packages/solver/package.json packages/solver/
COPY scrapers/csuf/package.json scrapers/csuf/
COPY scrapers/rmp/package.json scrapers/rmp/
RUN pnpm install --frozen-lockfile

COPY . .

FROM base AS api
EXPOSE 3001
CMD ["pnpm", "--filter", "@csufsched/api", "start"]

FROM base AS migrate
CMD ["pnpm", "--filter", "@csufsched/db", "migrate"]

FROM base AS scraper
CMD ["pnpm", "--filter", "@csufsched/scraper-csuf", "scrape:full"]

# Vite inlines the API URL at build time, so the frontend image is pinned to one
# backend and has to be rebuilt to point at another.
FROM base AS web-build
ARG VITE_API_URL=http://localhost:3001
RUN pnpm --filter @csufsched/web build

FROM nginx:alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
