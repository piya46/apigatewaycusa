'use strict';

const { randomUUID } = require('node:crypto');

const ROUTING_KEY = 'webhook:config:routing';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
class RoutingValidationError extends Error {}
class RoutingConflictError extends Error {}

function defaultRouting(config) {
  return {
    version: 1,
    revision: randomUUID(),
    apps: [
      { id: 'sso', name: 'CUSA SSO', url: config.ssoWebhookUrl },
      { id: 'chatbot', name: 'Chatbot', url: config.chatbotWebhookUrl }
    ],
    rules: [{ id: 'line-mfa', name: 'LINE MFA', enabled: true, eventType: 'postback', postback: { key: 'action', value: 'mfa' }, appId: 'sso' }],
    fallbackAppId: 'chatbot'
  };
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
function validateRouting(input) {
  const invalid = message => { throw new RoutingValidationError(message); };
  if (!object(input) || input.version !== 1 || !text(input.revision, 64)) invalid('Invalid routing version or revision');
  if (!Array.isArray(input.apps) || input.apps.length < 1 || input.apps.length > 30) invalid('Configure between 1 and 30 apps');
  if (!Array.isArray(input.rules) || input.rules.length > 100) invalid('Configure at most 100 rules');
  const appIds = new Set();
  const apps = input.apps.map(app => {
    if (!object(app) || typeof app.id !== 'string' || !ID.test(app.id) || appIds.has(app.id)) invalid('App IDs must be unique');
    if (!text(app.name, 100) || !text(app.url, 2048)) invalid('Each app needs a name and HTTPS URL');
    let url;
    try { url = new URL(app.url); } catch { invalid('Each app needs a valid HTTPS URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) invalid('App URLs must use HTTPS without credentials or fragments');
    appIds.add(app.id);
    return { id: app.id, name: app.name, url: url.href };
  });
  if (!appIds.has(input.fallbackAppId)) invalid('The fallback app must exist');
  const ruleIds = new Set();
  const rules = input.rules.map(rule => {
    if (!object(rule) || typeof rule.id !== 'string' || !ID.test(rule.id) || ruleIds.has(rule.id)) invalid('Rule IDs must be unique');
    if (!text(rule.name, 100) || typeof rule.enabled !== 'boolean') invalid('Each rule needs a name and enabled flag');
    if (!text(rule.eventType, 64) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(rule.eventType)) invalid('Invalid event type');
    if (!appIds.has(rule.appId)) invalid('Every rule must reference an existing app');
    let postback;
    if (rule.postback !== undefined) {
      if (rule.eventType !== 'postback' || !object(rule.postback)
        || !text(rule.postback.key, 128) || !text(rule.postback.value, 1024)) {
        invalid('Postback conditions require a postback event, parameter and value');
      }
      postback = { key: rule.postback.key, value: rule.postback.value };
    }
    ruleIds.add(rule.id);
    return { id: rule.id, name: rule.name, enabled: rule.enabled, eventType: rule.eventType, ...(postback ? { postback } : {}), appId: rule.appId };
  });
  return { version: 1, revision: input.revision, apps, rules, fallbackAppId: input.fallbackAppId };
}

const GET_OR_INITIALIZE = `
  local current = redis.call('GET', KEYS[1])
  if current then return current end
  redis.call('SET', KEYS[1], ARGV[1], 'NX')
  return ARGV[1]
`;
const SAVE = `
  local current = redis.call('GET', KEYS[1])
  if not current or cjson.decode(current).revision ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
`;

function createRoutingStore(redis, config) {
  const initial = JSON.stringify(validateRouting(defaultRouting(config)));
  return {
    async get() {
      const raw = await redis.eval(GET_OR_INITIALIZE, 1, ROUTING_KEY, initial);
      // Corrupt stored rules fail closed; never silently send to a default app.
      return validateRouting(JSON.parse(raw));
    },
    async save(input) {
      const normalized = validateRouting(input);
      const next = { ...normalized, revision: randomUUID() };
      if (await redis.eval(SAVE, 1, ROUTING_KEY, normalized.revision, JSON.stringify(next)) !== 1) {
        throw new RoutingConflictError('Routing was changed by another administrator; reload before saving');
      }
      return next;
    }
  };
}

module.exports = { createRoutingStore, defaultRouting, validateRouting, ROUTING_KEY, RoutingValidationError, RoutingConflictError };
