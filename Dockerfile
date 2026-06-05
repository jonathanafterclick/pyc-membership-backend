FROM node:20-bookworm-slim AS base

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npm run build

EXPOSE 8080

ENV PORT=8080

CMD ["npm", "run", "docker-start"]