# Build context is the repo root (Zeabur monorepo setup).
# This Dockerfile is pasted into the Zeabur service configuration.

FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json .
RUN npm ci
COPY frontend/ .
# `frontend/public/skill.md` is a git symlink → `../../skill.md` (repo root).
# That symlink dangles inside the build container because we only COPY
# the frontend/ subtree; overwrite it with the real file from the build
# context root so Vite's publicDir can stat it.
COPY skill.md ./public/skill.md
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
