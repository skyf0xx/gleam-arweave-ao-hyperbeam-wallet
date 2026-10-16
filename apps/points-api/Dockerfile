# Built from the repository root so the workspace's @gleam/core resolves:
#   docker build -f apps/points-api/Dockerfile .
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
WORKDIR /app
RUN corepack enable
COPY . .
# --ignore-scripts skips the root `prepare` (lefthook needs a git checkout).
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@gleam/points-api..."
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@gleam/points-api", "start"]
