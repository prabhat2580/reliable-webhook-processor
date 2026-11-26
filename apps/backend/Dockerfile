FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and backend packages
COPY package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/backend/tsconfig.json ./apps/backend/
COPY apps/backend/nest-cli.json ./apps/backend/
COPY apps/backend/src ./apps/backend/src

RUN npm install
RUN npm run build -w @webhook-processor/backend

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY apps/backend/src/db/init.sql ./apps/backend/dist/db/init.sql

WORKDIR /app/apps/backend

EXPOSE 3000
CMD ["node", "dist/main"]
