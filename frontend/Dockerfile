# Dev Dockerfile for React (Vite) frontend with HMR
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first for caching
COPY package*.json ./
RUN npm install

# Copy source (will be overridden by bind mount during dev)
COPY . .

EXPOSE 443

ENV CHOKIDAR_USEPOLLING=true \
    WATCHPACK_POLLING=true

CMD ["npm", "run", "dev"]
