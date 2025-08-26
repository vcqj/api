FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install deps
COPY package*.json ./
RUN npm ci

# Build TS → JS
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 4000
CMD ["node", "dist/index.js"]
