FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

ENV PORT=7000
EXPOSE 7000

CMD ["node", "server.js"]
