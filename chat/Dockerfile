FROM node:22.20.0-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
RUN adduser -D -u 10001 svc
USER svc
CMD ["node", "server.mjs"]
