# syntax=docker/dockerfile:1

# doodl ships as a single image that serves both the built client and the
# WebSocket game server from one process. That is what keeps the deployment to
# a single Fly app with no separate static host and no CORS configuration.

# ---------------------------------------------------------------------------
# Stage 1: build the client bundle and compile the server
# ---------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# Copy manifests first so the dependency layer is cached across source edits.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: production dependency tree
# ---------------------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json

# The client's runtime deps are already bundled into client/dist by Vite, so
# nothing here is actually loaded at run time except `ws`. Installing the whole
# production tree anyway keeps the workspace symlinks intact, which is what
# lets the server resolve @doodl/shared.
RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./package.json

# node_modules/@doodl/shared is a workspace symlink into ./shared, so the real
# directory has to exist alongside it.
COPY shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist

COPY server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist

COPY --from=build /app/client/dist ./client/dist

USER node
EXPOSE 8080

# No init system needed: the server installs its own SIGTERM handler and closes
# sockets before exiting, so Fly's rolling restarts are graceful.
CMD ["node", "server/dist/index.js"]
