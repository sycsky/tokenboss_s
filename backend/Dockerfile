# Build context is repo root — all COPY paths are relative to repo root.

# ── Stage 1: install deps (compiles better-sqlite3 native module) ──
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci

# ── Stage 2: compile TypeScript ──
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ .
RUN npm run build

# ── Stage 3: runtime ──
FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/data ./data
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "dist/local.js"]
