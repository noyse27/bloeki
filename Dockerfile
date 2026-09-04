# Used by CI's docker-image-scan job (bloeki:ci) and mirrors
# backend/Dockerfile. Frontend has its own Dockerfile, composed together
# via docker-compose.yml. No ffmpeg/ffprobe here on purpose - the
# rechenintensive Zuschneiden passiert in tools/snippet-cutter, nicht im
# Backend (siehe dessen README).
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend ./backend
RUN npm run build --workspace backend

FROM node:26-alpine AS runtime
# Picks up whatever Alpine security patches (e.g. openssl/libcrypto3/libssl3)
# have landed since this image tag was baked - CI's Trivy scan fails the
# build on known-fixed HIGH/CRITICAL CVEs in the base image, and floating
# tags like node:22-alpine can lag behind Alpine's own package index.
RUN apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace backend --omit=dev
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/migrations ./backend/migrations
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app/backend
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
