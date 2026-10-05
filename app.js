'use strict';

const { ConfigurationError, loadEnvironment } = require('./src/config');
const { createLogger } = require('./src/logger');
const { createRedis } = require('./src/redis');
const { createQueue } = require('./src/queue');
const { createRoutingStore } = require('./src/routing-store');
const { createSsoService } = require('./src/sso');
const { createForwarder } = require('./src/forward');
const { Worker } = require('./src/worker');
const { createApp } = require('./src/app');
const { createShutdown } = require('./src/shutdown');

function main() {
  process.umask(0o077);
  let config;
  let logger;
  try {
    config = loadEnvironment();
    logger = createLogger(config);
  } catch (error) {
    // Even configuration/IO errors may carry paths or credentials.
    const detail = error instanceof ConfigurationError ? error.message : 'Check .env against .env.example and private file paths';
    process.stderr.write(`Startup configuration is invalid: ${detail}.\n`);
    process.exitCode = 1;
    return;
  }
  const redis = createRedis(config, logger);
  const queue = createQueue(redis, config);
  const routingStore = createRoutingStore(redis, config);
  const sso = createSsoService(redis, config.sso);
  const forward = createForwarder(config);
  const worker = new Worker({ queue, routingStore, forward, config, logger });
  const app = createApp({ config, queue, routingStore, sso, logger });

  // Passenger intercepts the first http.Server.listen() call (reverse binding).
  const server = app.listen(config.port, config.host, () => {
    logger.info('server_started');
    worker.start();
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  const shutdown = createShutdown({ server, worker, redis, logger, timeoutMs: config.shutdownTimeoutMs });
  server.on('error', () => { logger.error('server_error'); void shutdown(1); });
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  // Passenger's loader emits this event when its control pipe closes.
  global.PhusionPassenger?.once('exit', () => void shutdown());
  process.once('uncaughtException', () => { logger.error('fatal_error'); void shutdown(1); });
  process.once('unhandledRejection', () => { logger.error('fatal_error'); void shutdown(1); });
  // A temporary Redis outage must not prevent /ping from bringing Passenger up.
  // Requests fail closed with 503 until Redis is ready; ioredis reconnects.
  redis.connect().catch(() => logger.warn('redis_error'));
}

// This is an entrypoint, not the importable Express factory (src/app.js).
// Passenger starts applications with require(startupFile), so require.main is
// the Passenger loader and must not gate startup here.
main();
