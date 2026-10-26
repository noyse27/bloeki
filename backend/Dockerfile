# Build context is the repo root (see docker-compose.yml / root Dockerfile)
# because this is an npm workspaces project with a single root lockfile.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend ./backend
RUN npm run build --workspace backend
RUN node -e "const fs=require('fs');const p=require('./package.json');const d=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(/\D/g,'');fs.writeFileSync('/app/backend/dist/build-version.txt',p.version+'_'+d)"

FROM node:26-alpine AS runtime
# Keep in sync with the root Dockerfile's runtime stage - see its comment.
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
