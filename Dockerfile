FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache su-exec

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY --chown=node:node . .

USER root

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
