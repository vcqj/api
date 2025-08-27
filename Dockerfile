FROM node:20-alpine
WORKDIR /app

# install deps INCLUDING dev (needed for tsc)
COPY package*.json ./
RUN npm ci --include=dev

# build TS → JS
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# drop dev deps and switch to production
RUN npm prune --omit=dev
ENV NODE_ENV=production

EXPOSE 4000
CMD ["node", "dist/index.js"]