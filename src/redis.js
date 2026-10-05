'use strict';

const Redis = require('ioredis');

function createRedis(config, logger) {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
    connectTimeout: config.redisCommandTimeoutMs,
    commandTimeout: config.redisCommandTimeoutMs,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    retryStrategy: attempts => Math.min(attempts * 250, 5000),
    reconnectOnError: error => error.message.includes('READONLY')
  });
  redis.on('ready', () => logger.info('redis_ready'));
  // Never pass Redis errors to the logger; they may include commands and payloads.
  redis.on('error', () => logger.warn('redis_error'));
  redis.on('reconnecting', () => logger.debug('redis_reconnecting'));
  return redis;
}

async function closeRedis(redis) {
  try {
    if (redis.status === 'ready') await redis.quit();
  } finally { redis.disconnect(); }
}

module.exports = { createRedis, closeRedis };
