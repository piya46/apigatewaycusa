'use strict';

const { loadEnvironment } = require('../src/config');
const { createRedis, closeRedis } = require('../src/redis');
const { createQueue } = require('../src/queue');

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--oldest') {
    process.stderr.write('Usage: npm run dlq:replay -- --oldest\nReplays one oldest DLQ entry. Verify downstream state before replaying interrupted/time-out jobs.\n');
    process.exitCode = 1;
    return;
  }
  const config = loadEnvironment();
  const silent = { info() {}, warn() {}, debug() {} };
  const redis = createRedis(config, silent);
  try {
    await redis.connect();
    const result = await createQueue(redis, config).replayOldest();
    // The result is a fixed status; payloads and identifiers never reach stdout.
    process.stdout.write(`DLQ replay: ${result}\n`);
    if (!['replayed', 'empty'].includes(result)) process.exitCode = 1;
  } finally { await closeRedis(redis); }
}

main().catch(() => {
  process.stderr.write('DLQ replay failed. Check configuration and Redis connectivity.\n');
  process.exitCode = 1;
});
