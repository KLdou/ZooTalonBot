#!/bin/sh
set -e

mkdir -p /app/logger
mkdir -p /app/documents
touch /app/logger/zoo-bot.log
chown -R node:node /app/logger
chown -R node:node /app/documents
chmod 775 /app/logger
chmod 775 /app/documents
chmod 664 /app/logger/zoo-bot.log

exec su-exec node "$@"
