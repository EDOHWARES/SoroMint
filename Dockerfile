FROM node:20-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server/ .
EXPOSE 5000
CMD ["node", "index.js"]