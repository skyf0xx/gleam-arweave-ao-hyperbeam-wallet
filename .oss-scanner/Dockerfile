# Image for Anthropic's OSS Scanner (github.com/anthropics/oss-scanner).
# It installs the workspace, builds the extension and the mobile web bundle,
# and runs the Vitest suite. The native iOS and Android projects are not built.
FROM node:25-bookworm@sha256:78839ac448c23517f8eab2e8f7943d9b4f73979eb7f8bed2c73dbf72ff869e7b

ENV CI=true \
    NODE_OPTIONS=--max-old-space-size=8192

RUN apt-get update && apt-get install -y --no-install-recommends zip \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

COPY . /src
WORKDIR /src

RUN git config --global --add safe.directory /src \
    && pnpm install --frozen-lockfile

RUN pnpm wxt:build && pnpm mobile:build

# The tests stub the network, so they run offline. A failing test does not
# fail the image.
RUN pnpm vitest run || echo "WARNING: vitest reported failures"

CMD ["bash"]
