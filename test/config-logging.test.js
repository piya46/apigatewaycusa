'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, privatePath } = require('../src/config');
const { createLogger, sanitizeMetadata } = require('../src/logger');
const { config } = require('./helpers');

const env = {
  LINE_CHANNEL_SECRET: config.lineChannelSecret,
  REDIS_URL: 'rediss://default:test-password@redis.example.test:6379',
  INTERNAL_API_TOKEN: config.internalApiToken,
  PING_SECRET: config.pingSecret,
  SSO_WEBHOOK_URL: config.ssoWebhookUrl,
  CHATBOT_WEBHOOK_URL: config.chatbotWebhookUrl
};

test('secure configuration defaults and mandatory TLS', () => {
  const loaded = loadConfig(env);
  assert.equal(loaded.enforceHttps, true);
  assert.equal(loaded.trustProxy, false);
  assert.equal(loaded.forwardTimeoutMs, 4000);
  assert.equal(loaded.logRetentionDays, 14);
  const bad = [
    { REDIS_URL: 'redis://default:secret@localhost:6379' },
    { REDIS_URL: 'rediss://default:secret@localhost:6379?tls=false' },
    { SSO_WEBHOOK_URL: 'http://sso.example.test' },
    { CHATBOT_WEBHOOK_URL: 'https://user:password@chatbot.example.test' },
    { ENFORCE_HTTPS: 'false' }, { TRUST_PROXY: 'true' }, { TRUST_PROXY: '1' },
    { INTERNAL_API_TOKEN: 'short' }, { PING_SECRET: '' },
    { FORWARD_TIMEOUT_MS: '9000' }, { FORWARD_TIMEOUT_MS: '3000ms' },
    { LOG_RETENTION_DAYS: '30' }, { JWT_ISSUER: 'issuer-without-key' },
    { LOG_DIR: '/private/tmp/public_html/logs' }, { SSO_WEBHOOK_GATEWAY_TOKEN: 'g'.repeat(43) },
    { LINE_WEBHOOK_DESTINATION: '@bot-id' },
    { SSO_WEBHOOK_GATEWAY_TOKEN: 'invalid', LINE_WEBHOOK_DESTINATION: `U${'0'.repeat(32)}` },
    { SSO_WEBHOOK_GATEWAY_TOKEN: 'g'.repeat(43), INTERNAL_API_TOKEN: 'g'.repeat(43), LINE_WEBHOOK_DESTINATION: `U${'0'.repeat(32)}` }
  ];
  for (const override of bad) assert.throws(() => loadConfig({ ...env, ...override }));
  assert.equal(loadConfig({ ...env, SSO_WEBHOOK_GATEWAY_TOKEN: 'g'.repeat(43), LINE_WEBHOOK_DESTINATION: `U${'0'.repeat(32)}` }).ssoWebhookGatewayToken, 'g'.repeat(43));
});

test('rejects private paths under public_html including symlinked ancestors', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scicu-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'public_html'));
  fs.symlinkSync(path.join(root, 'public_html'), path.join(root, 'alias'));
  assert.throws(() => privatePath(path.join(root, 'public_html', '.env')));
  assert.throws(() => privatePath(path.join(root, 'alias', 'new-folder', 'logs')));
  assert.equal(privatePath(path.join(root, 'private')), path.join(root, 'private'));
  assert.throws(() => privatePath(path.resolve(__dirname, '../public/.env')));
});

test('SSO configuration validates application identity, backend key and callback', () => {
  const configured = { ...env, SSO_APPLICATION_ID: '22222222-2222-4222-8222-222222222222', SSO_API_KEY: 'private-api-key' };
  const value = loadConfig(configured);
  assert.equal(value.sso.origin, 'https://sso.reunion.scicu-alumni.com');
  assert.equal(value.sso.redirectUri, 'https://api.reunion.scicu-alumni.com/auth/sso/callback');
  for (const change of [
    { SSO_API_KEY: '' }, { SSO_APPLICATION_ID: 'not-a-uuid' },
    { SSO_ORIGIN: 'http://sso.example.test' }, { SSO_ORIGIN: 'https://sso.example.test/path' },
    { SSO_REDIRECT_URI: 'https://gateway.example.test/wrong-callback' },
    { SSO_REDIRECT_URI: 'https://gateway.example.test/auth/sso/callback?next=evil' }
  ]) assert.throws(() => loadConfig({ ...configured, ...change }));
});

test('metadata allowlist removes payloads, exceptions, URLs, IDs and secrets', () => {
  assert.deepEqual(sanitizeMetadata({
    count: 2, status: 500, target: 'chatbot', reason: 'timeout', durationMs: 5,
    body: 'secret', error: new Error('private'), webhookEventId: 'private', url: 'secret', token: 'secret'
  }), { count: 2, status: 500, durationMs: 5, target: 'chatbot', reason: 'timeout' });
  assert.deepEqual(sanitizeMetadata({ status: 'PII', target: 'PII', reason: 'PII' }), {});
});

test('rotating file output never contains arbitrary messages or sensitive metadata', async t => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scicu-log-'));
  t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const logger = createLogger({ logDir, logLevel: 'info', logRetentionDays: 7, logMaxSize: '10m' });
  logger.info('event_dead_lettered', { count: 1, target: 'chatbot', body: 'SECRET_PII', token: 'SECRET_TOKEN' });
  logger.error('SECRET_MESSAGE', { error: new Error('SECRET_STACK') });
  await logger.close();
  const logs = fs.readdirSync(logDir).filter(file => file.endsWith('.log'));
  assert.equal(logs.length, 1);
  const output = fs.readFileSync(path.join(logDir, logs[0]), 'utf8');
  assert.match(output, /event_dead_lettered/);
  assert.match(output, /unclassified/);
  assert.doesNotMatch(output, /SECRET/);
  assert.equal(fs.statSync(path.join(logDir, logs[0])).mode & 0o777, 0o600);
});
