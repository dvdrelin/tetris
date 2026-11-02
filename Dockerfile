# ============================================================================
# Multi-stage build for Neon Tetris
# Stage 1: Build frontend and backend
# Stage 2: Production runtime (Node.js only, no build tools)
# ============================================================================

# --- Stage 1: Build ---
# node:22-alpine: на node:20-alpine (20.20.2) `npm install` даёт EBADENGINE
# (abbrev@5.0.0 и nopt@10.0.1 требуют ^22.22.2 || ^24.15.0 || >=26.0.0), а Vite 8
# требует ^20.19 || >=22.12. На node 22 сборка проходит без предупреждений.
FROM node:22-alpine AS builder

# Version string (deploy.sh computes 2.{YY}.{MM}.{git short hash}); passed through to the
# frontend build below so the bundle carries the same version as the container ENV/health.
ARG APP_VERSION=""

# Install build dependencies for TypeScript compilation
RUN apk add --no-cache git

WORKDIR /app

# Copy root package.json and workspaces configs
COPY package*.json ./

# Copy workspace package.json files
COPY frontend/package*.json frontend/
COPY backend/package*.json backend/
COPY shared/package*.json shared/

# Install all dependencies (including dev dependencies needed for build)
RUN npm install

# Shared first: the backend (CommonJS) compiles against shared/dist typings and the
# frontend resolves @neon-tetris/shared to shared/src through the vite alias.
COPY tsconfig.base.json ./tsconfig.base.json
COPY shared/ ./shared/
RUN cd shared && npx tsc -p tsconfig.json

# Copy frontend source and build
COPY frontend/ ./frontend/
# APP_VERSION env: vite.config.mts stamps scripts/app-version.cjs into the bundle
# (define __APP_VERSION__ — the version chip in the menu corner).
RUN cd frontend && npm install && APP_VERSION=$APP_VERSION npx vite build

# Copy backend source and build
COPY backend/ ./backend/
RUN cd backend && npm install && npm run build

# --- Stage 2: Production runtime ---
FROM node:22-alpine AS production

WORKDIR /app

# Workspace root, not just backend: backend/dist requires '@neon-tetris/shared', and that
# link only exists if npm installs the workspace set here. vue/pinia are also installed
# (unused at runtime) — a few MB for keeping the runtime resolution identical to dev.
COPY package*.json ./
COPY frontend/package*.json frontend/
COPY backend/package*.json backend/
COPY shared/package*.json shared/
RUN npm ci --omit=dev

# Copy built shared, frontend and backend dist
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/backend/dist ./backend/dist

# Copy backend data directory for score persistence
RUN mkdir -p /app/backend/data

ENV NODE_ENV=production
ENV PORT=3000

# Версия: формат 2.{YY}.{MM}.{git short hash}, например 2.26.11.317de99 (мажор — вручную,
# 2 = мультиплеерный MVP). Значение передаётся build-аргом (docker-compose.yml ->
# build.args.APP_VERSION, вычисляет deploy.sh из клонированного репозитория) и используется
# дважды: здесь как ENV для GET /api/health и выше в stage 1 как env для vite build (чип
# версии в углу меню). Если arg не передан, APP_VERSION пуст и health берёт version из
# backend/package.json (он скопирован выше).
ARG APP_VERSION=""
ENV APP_VERSION=$APP_VERSION

EXPOSE 3000

CMD ["node", "backend/dist/index.js"]
