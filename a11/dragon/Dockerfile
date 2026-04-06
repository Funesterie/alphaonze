FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY DRAGON_MANIFEST.json ./
COPY .env.example ./
COPY README.md ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci --no-audit --no-fund
RUN npm run build

ENV NODE_ENV=production
ENV DRAGON_SERVICE=api

EXPOSE 4600

CMD ["sh", "-lc", "if [ \"$DRAGON_SERVICE\" = \"daemon\" ]; then npm --workspace @funeste38/dragon run start; else npm --workspace @funeste38/dragon-api run start; fi"]
