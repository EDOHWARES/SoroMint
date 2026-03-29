# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY server/package*.json ./

RUN npm ci

COPY server/ .

# ─── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY server/package*.json ./

RUN npm ci --omit=dev

COPY --from=builder /app .

EXPOSE 5000

CMD ["node", "index.js"]
