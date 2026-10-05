'use strict';

const { closeRedis } = require('./redis');

function createShutdown({ server, worker, redis, logger, timeoutMs, exit = code => process.exit(code) }) {
  let pending;
  return function shutdown(code = 0) {
    if (pending) return pending;
    pending = (async () => {
      logger.info('shutdown_started');
      const deadline = setTimeout(() => {
        logger.error('shutdown_timeout');
        server.closeAllConnections?.();
        redis.disconnect();
        exit(1);
      }, timeoutMs);
      try {
        // Stop accepting requests and stop scheduling work, then drain both
        // before closing Redis: admitted webhook requests can still enqueue.
        const drained = new Promise((resolve, reject) => {
          server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
          server.closeIdleConnections?.();
        });
        await Promise.all([drained, worker.stop()]);
        await closeRedis(redis);
        logger.info('shutdown_complete');
        await logger.close();
        clearTimeout(deadline);
        exit(code);
      } catch {
        logger.error('shutdown_error');
        redis.disconnect();
        clearTimeout(deadline);
        exit(1);
      }
    })();
    return pending;
  };
}

module.exports = { createShutdown };
