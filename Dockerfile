# ============================================================================
# Multi-stage build for Neon Tetris
# Stage 1: Build frontend and backend
# Stage 2: Production runtime (Node.js only, no build tools)
# ============================================================================

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

# Install build dependencies for TypeScript compilation
RUN apk add --no-cache git

WORKDIR /app

# Copy root package.json and workspaces configs
COPY package*.json ./

# Copy workspace package.json files
COPY frontend/package*.json frontend/
COPY backend/package*.json backend/

# Install all dependencies (including dev dependencies needed for build)
RUN npm install

# Copy frontend source and build
COPY frontend/ ./frontend/
COPY tsconfig.base.json ./frontend/
RUN cd frontend && npm install && npx vite build

# Copy backend source and build
COPY backend/ ./backend/
RUN cd backend && npm install && npm run build

# --- Stage 2: Production runtime ---
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies for backend
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Copy built frontend and backend dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/backend/dist ./backend/dist

# Copy backend data directory for score persistence
RUN mkdir -p /app/backend/data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "backend/dist/index.js"]
