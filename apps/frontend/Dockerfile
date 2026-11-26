FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/frontend/tsconfig.json ./apps/frontend/
COPY apps/frontend/next.config.mjs ./apps/frontend/next.config.mjs
COPY apps/frontend/tailwind.config.js ./apps/frontend/tailwind.config.js
COPY apps/frontend/postcss.config.js ./apps/frontend/postcss.config.js
COPY apps/frontend/public ./apps/frontend/public
COPY apps/frontend/src ./apps/frontend/src

RUN npm install
RUN npm run build -w @webhook-processor/frontend

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public
COPY --from=builder /app/apps/frontend/package.json ./apps/frontend/package.json

WORKDIR /app/apps/frontend

EXPOSE 3001
CMD ["npx", "next", "start", "-p", "3001"]
