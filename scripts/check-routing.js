'use strict';

const { ConfigurationError, loadEnvironment } = require('../src/config');
const { createRedis, closeRedis } = require('../src/redis');
const { ROUTING_KEY, defaultRouting, migrateRouting, validateRouting, RoutingValidationError } = require('../src/routing-store');
const silent = { info() {}, warn() {}, error() {}, debug() {} };

function inspectRouting(raw, config) {
  const current = raw === null ? null : JSON.parse(raw);
  const next = current === null ? defaultRouting(config) : current.version === 1
    ? migrateRouting(current, config) : validateRouting(current);
  if (next.apps.find(app => app.id === 'sso')?.url !== config.ssoWebhookUrl) {
    throw new RoutingValidationError('SSO URL in routing must match SSO_WEBHOOK_URL; review both before deploying');
  }
  return { state: current === null ? 'not_initialized' : current.version === 1 ? 'migration_ready' : 'current', apps: next.apps.length, rules: next.rules.length };
}

async function main(args = process.argv.slice(2)) {
  if (args.length) { process.stderr.write('Usage: npm run routing:check\n'); return 1; }
  let redis;
  try {
    const config = loadEnvironment();
    redis = createRedis(config, silent);
    await redis.connect();
    const report = inspectRouting(await redis.get(ROUTING_KEY), config);
    process.stdout.write(`Routing: ${report.state}. Apps: ${report.apps}; general rules: ${report.rules}.\n`);
    process.stdout.write('Protected CUSA MFA and pinned SSO URL: ready. Read-only check; no routing or queue changes.\n');
    if (report.state === 'migration_ready') process.stdout.write('The new application will back up and migrate routing on its first routing read. Stop all old processes before deploying.\n');
    return 0;
  } catch (error) {
    const detail = error instanceof ConfigurationError || error instanceof RoutingValidationError
      ? error.message : 'Check Redis connectivity and stored routing format';
    process.stderr.write(`Routing check failed: ${detail}. No values were displayed or changed.\n`);
    return 1;
  } finally {
    if (redis) { try { await closeRedis(redis); } catch { redis.disconnect(); } }
  }
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
module.exports = { inspectRouting, main };
