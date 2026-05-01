# Stage 1: deps
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# Stage 2: production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY . .

COPY scripts/generate-certs.sh ./scripts/generate-certs.sh
RUN chmod +x ./scripts/generate-certs.sh && ./scripts/generate-certs.sh

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 5000

CMD ["node", "src/server.js"]
