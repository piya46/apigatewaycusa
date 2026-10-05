'use strict';

const { createHmac } = require('node:crypto');

const config = {
  port: 3000, enforceHttps: false, trustProxy: false,
  lineChannelSecret: 'test-line-channel-secret',
  internalApiToken: 'internal-test-token-12345678901234567890',
  pingSecret: 'ping-test-secret-12345678901234567890',
  ssoWebhookUrl: 'https://sso.example.test/api/line/mfa',
  chatbotWebhookUrl: 'https://chatbot.example.test/webhook',
  forwardTimeoutMs: 4000, workerPollMs: 10, workerLeaseMs: 30000,
  queueMaxLength: 100, redisCommandTimeoutMs: 500,
  jwt: undefined
};
const logger = { info() {}, warn() {}, error() {}, debug() {}, async close() {} };
const event = (id = 'event-1', extra = {}) => ({ type: 'message', webhookEventId: id, message: { type: 'text', text: 'private message' }, ...extra });
const payload = (...events) => ({ destination: 'U-test-destination', events });
const sign = raw => createHmac('sha256', config.lineChannelSecret).update(raw).digest('base64');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
module.exports = { config, logger, event, payload, sign, pause, deferred };
