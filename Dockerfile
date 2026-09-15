# The dashboard server: a node:http process that serves the built React app and
# proxies published radar.json from scriptlr (src/server.ts). It carries NO API
# keys and never publishes — that is the Jenkins daily scan's job. This image
# only READS the snapshot the scan wrote, so it needs no secrets.
#
# Two stages: `build` compiles the React app (web/dist) and installs the root
# devDependencies (tsx runs the TypeScript server at runtime — there are no
# runtime deps, per the zero-dependency rule). `runtime` keeps only what the
# server needs to run: root node_modules, src/, web/dist and the manifest.

# ---- build ----------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# Root install first (cached until the lockfile changes). NOT --omit=dev: tsx and
# typescript are devDependencies and there is nothing to run without them.
COPY package.json package-lock.json ./
RUN npm ci

# Web app deps, then the whole tree, then the Vite build → web/dist.
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY . .
RUN npm run web:build

# ---- runtime --------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787

# Only the pieces the server touches. web/node_modules (the Vite toolchain) and
# the build's own caches are left behind; out/ and data/ are absent by design —
# a deployed instance reads scriptlr, not local disk.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/web/dist ./web/dist

EXPOSE 8787
USER node

# Exec form so node is PID 1 and receives SIGTERM directly (clean pod shutdown).
# No --env-file: there is no .env in the image and none is needed; SCRIPTLR_READ_URL
# defaults to the in-cluster address in config.ts.
CMD ["node", "--import", "tsx", "src/server.ts"]
