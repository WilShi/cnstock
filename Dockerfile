# syntax=docker/dockerfile:1
#
# cnstock MCP server, speaking JSON-RPC over stdio (no port to expose).
# Build:  docker build -t cnstock-mcp .
# Run:    docker run --rm -i cnstock-mcp   (speak MCP on stdin/stdout)

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# --ignore-scripts is required here: the "prepare" hook runs tsdown, but the
# sources are not copied in yet at this point.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json tsdown.config.ts ./
COPY src ./src
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# Runtime deps only. The pnpm content-addressable store roughly triples the
# layer size and is useless once the links in node_modules exist, so drop it.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
 && rm -rf "$(pnpm store path)"

# --chown avoids a separate recursive chown layer.
COPY --from=build --chown=node:node /app/dist ./dist

# The build context is the working tree, where file modes are not guaranteed to
# match git's 0644. Normalise so the unprivileged "node" user can read the
# manifest that the runtime reads its version from.
RUN chmod -R a+rX /app

# node:alpine already ships an unprivileged "node" user.
USER node

# No HTTP listener: this is a stdio transport server.
ENTRYPOINT ["node", "dist/mcp.js"]
