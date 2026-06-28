# Stage 1: build React client
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --silent
COPY client/ ./
RUN npm run build

# Stage 2: production image
FROM node:20-slim AS production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --silent

COPY api/ ./api/
COPY database/ ./database/
COPY --from=client-build /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "api/server.js"]
