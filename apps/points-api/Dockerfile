# Built from the repository root so the workspace's @gleam/core resolves:
#   docker build -f apps/points-api/Dockerfile .
FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370
WORKDIR /app
RUN corepack enable
COPY . .
# --ignore-scripts skips the root `prepare` (lefthook needs a git checkout).
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@gleam/points-api..."
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@gleam/points-api", "start"]
