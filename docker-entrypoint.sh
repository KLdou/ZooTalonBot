#!/bin/sh
set -e

mkdir -p /app/logger
touch /app/logger/zoo-bot.log
chown -R node:node /app/logger
chmod 775 /app/logger
chmod 664 /app/logger/zoo-bot.log

exec su-exec node "$@"
