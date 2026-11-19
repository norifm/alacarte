# Build the frontend (Vite outputs to backend/public via outDir: '../backend/public').
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend ./
RUN npm run build
# Build output is now at /app/backend/public

# Build app deps with Node 22
FROM node:22-bookworm-slim AS node-build
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY backend/server.mjs ./
COPY backend/routes ./routes
COPY backend/lib ./lib
COPY backend/scripts ./scripts
COPY --from=frontend-build /app/backend/public ./public

# Source stage for Node 22 runtime binaries
FROM node:22-bookworm-slim AS node-runtime

# Runtime base: upstream amdp image contains apple-music-dl + MP4Box + libgpac
# on Ubuntu 24.04 (glibc 2.39). Pinned to upstream commit 0d895e0b (built
# 2026-08-21): their :latest drifted to a musl-linked binary that cannot
# execve in this Ubuntu-based image, which made every download fail with
# "spawn apple-music-dl ENOENT".
FROM ghcr.io/zhaarey/apple-music-downloader@sha256:e9364425b5034bdb55414672992bd369b65c9542832eac6de97b9d6994feecf3

ENV DEBIAN_FRONTEND=noninteractive
# musl ships /lib/ld-musl-x86_64.so.1 so musl-linked apple-music-dl builds
# (see upstream #29 / GH issue #28) can execve here too, while glibc builds
# keep working unchanged.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      musl \
      tini \
      curl \
      && rm -rf /var/lib/apt/lists/*

# Inject Node 22 runtime from the official Node image.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# App
WORKDIR /app
COPY --from=node-build /app /app
COPY backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod 755 /app/docker-entrypoint.sh

# Build-time sanity checks so regressions are caught early.
RUN MP4Box -version 2>&1 | grep -q 'GPAC version' || (echo 'MP4Box runtime check failed' && exit 1)
RUN command -v apple-music-dl >/dev/null
# The binary must actually execve — a musl-linked build on this glibc image
# fails here with ENOENT, which would break every download job at runtime.
RUN rc=0; apple-music-dl --help >/dev/null 2>&1 || rc=$?; if [ "$rc" = "127" ]; then echo 'apple-music-dl cannot be executed (wrong libc / missing loader)' >&2; exit 1; fi

EXPOSE 7373
# The entrypoint drops to PUID/PGID when they are set (see .env.example).
ENTRYPOINT ["/usr/bin/tini","--","/app/docker-entrypoint.sh"]
CMD ["node","server.mjs"]
