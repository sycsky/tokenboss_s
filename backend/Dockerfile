# Build context is the repo root (Zeabur monorepo setup).
# This Dockerfile is pasted into the Zeabur service configuration.

FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package*.json .
RUN npm ci --include=dev
COPY backend/ .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/config ./config
COPY --from=build /app/package.json ./package.json
# public/skill.md is a symlink to ../../skill.md (repo root, single source
# of truth). COPY preserves the symlink but never brought its target into
# the image, so /skill.md 500'd with ENOENT in production. Place the real
# file where the link resolves (/app/public/../../skill.md = /skill.md).
COPY skill.md /skill.md
EXPOSE 8080
ENV NODE_ENV=production
CMD ["node", "dist/local.js"]
