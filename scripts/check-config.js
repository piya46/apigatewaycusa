'use strict';

const { ConfigurationError, loadEnvironment } = require('../src/config');
const { createApp } = require('../src/app');
const { createRedis, closeRedis } = require('../src/redis');

const silent = { info() {}, warn() {}, debug() {}, error() {} };

async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--redis')) {
    process.stderr.write('Usage: npm run config:check [-- --redis]\n');
    return 1;
  }
  let config;
  try {
    config = loadEnvironment();
    // Express compiles TRUST_PROXY here; no HTTP server or worker is started.
    createApp({ config, queue: {}, logger: silent });
  } catch (error) {
    const message = error instanceof ConfigurationError
      ? error.message
      : 'Check TRUST_PROXY addresses and access to private configuration files';
    process.stderr.write(`Configuration invalid: ${message}.\n`);
    return 1;
  }
  process.stdout.write('Configuration OK. Secret values are not displayed.\n');
  process.stdout.write('SSO delivery: original LINE body + signature; URL pinned to SSO_WEBHOOK_URL.\n');
  process.stdout.write(config.ssoWebhookGatewayToken ? 'SSO gateway credential: dedicated token configured (must match SSO).\n' : 'SSO gateway credential: legacy compatibility; dedicated token not configured.\n');
  process.stdout.write(config.lineWebhookDestination ? 'LINE destination: pinned.\n' : 'Recommendation: set LINE_WEBHOOK_DESTINATION on Gateway and SSO to pin the OA.\n');
  process.stdout.write(config.sso ? 'SSO admin login: configured.\n' : 'SSO admin login: not configured. Set SSO_APPLICATION_ID and SSO_API_KEY to enable it.\n');
  process.stdout.write(config.jwt ? 'JWT: configured.\n' : 'JWT: not configured; future /v1 resources will return 503.\n');
  if (!args.includes('--redis')) {
    process.stdout.write('Offline check only. Use --redis to test the TLS connection with PING.\n');
    return 0;
  }

  let redis;
  try {
    redis = createRedis(config, silent);
    await redis.connect();
    if (await redis.ping() !== 'PONG') throw new Error();
    process.stdout.write('Redis TLS connection and authentication OK. No queue jobs were read or changed.\n');
    return 0;
  } catch {
    process.stderr.write('Redis check failed. Verify REDIS_URL, credentials, certificate trust and outbound network access.\n');
    return 1;
  } finally {
    if (redis) {
      try { await closeRedis(redis); } catch { redis.disconnect(); }
    }
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write('Configuration check failed. No configuration values were displayed.\n');
    process.exitCode = 1;
  });
}

module.exports = { main };
