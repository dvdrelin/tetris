FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

RUN npx tsc --build

COPY dist/ ./dist/

EXPOSE 3000

CMD ["node", "dist/index.js"]
