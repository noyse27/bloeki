# Build context is the repo root (see docker-compose.yml) because this is an
# npm workspaces project with a single root lockfile.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend ./frontend
ARG VITE_BETA_DEBUG_LOGGING=false
ENV VITE_BETA_DEBUG_LOGGING=$VITE_BETA_DEBUG_LOGGING
RUN npm run build --workspace frontend

FROM nginx:1.27-alpine AS runtime
# See root Dockerfile's runtime-stage comment - same reasoning, this image
# also ships an Alpine base with its own openssl/libcrypto3/libssl3.
RUN apk upgrade --no-cache
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
