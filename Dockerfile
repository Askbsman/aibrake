# syntax=docker/dockerfile:1.7

# ------- Build stage -------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund

COPY src ./src
RUN npm run build

# ------- Runtime stage -------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
# Stage 0.3 default — partners override these per deployment.
ENV AGENT_SPEND_GUARD_AUTH_MODE=required
ENV AGENT_SPEND_GUARD_LOG_SINK=jsonl
ENV AGENT_SPEND_GUARD_LOG_PATH=/app/logs/decisions.jsonl

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/logs && chown -R node:node /app/logs
USER node

EXPOSE 8080
CMD ["node", "dist/server.js"]
