'use strict';

const { randomUUID } = require('node:crypto');

const ROUTING_KEY = 'webhook:config:routing';
const ROUTING_BACKUP_KEY = 'webhook:config:routing:backup:v1';
const ID = /^[A-Za-z0-9_-]{1,64}$/;
class RoutingValidationError extends Error {}
class RoutingConflictError extends Error {}

function defaultRouting(config) {
  return {
    version: 2,
    revision: randomUUID(),
    apps: [
      { id: 'sso', name: 'CUSA SSO', url: config.ssoWebhookUrl },
      { id: 'chatbot', name: 'Chatbot', url: config.chatbotWebhookUrl }
    ],
    // CUSA MFA is a protected protocol, evaluated before user-managed rules.
    rules: [],
    fallbackAppId: 'chatbot'
  };
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
function validateRouting(input) {
  const invalid = message => { throw new RoutingValidationError(message); };
  if (!object(input) || input.version !== 2 || !text(input.revision, 64)) invalid('Invalid routing version or revision; reload the administration page');
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
  if (input.fallbackAppId !== null && !appIds.has(input.fallbackAppId)) invalid('The fallback app must exist or be null for Reject');
  if (!appIds.has('sso') || input.fallbackAppId === 'sso') invalid('CUSA SSO must exist and cannot be a fallback');
  const ruleIds = new Set();
  const rules = input.rules.map(rule => {
    if (!object(rule) || typeof rule.id !== 'string' || !ID.test(rule.id) || ruleIds.has(rule.id)) invalid('Rule IDs must be unique');
    if (!text(rule.name, 100) || typeof rule.enabled !== 'boolean') invalid('Each rule needs a name and enabled flag');
    if (!text(rule.eventType, 64) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(rule.eventType)) invalid('Invalid event type');
    if (rule.action !== undefined && !['forward', 'reject'].includes(rule.action)) invalid('Invalid rule action');
    const reject = rule.action === 'reject';
    if (reject ? rule.appId !== undefined : !appIds.has(rule.appId)) invalid('Forward rules need an app; Reject rules must not include appId');
    if (rule.appId === 'sso') invalid('CUSA SSO accepts only protected cusa_mfa events; remove the generic SSO rule');
    let postback;
    if (rule.postback !== undefined) {
      if (rule.eventType !== 'postback' || !object(rule.postback)
        || !text(rule.postback.key, 128) || !text(rule.postback.value, 1024)) {
        invalid('Postback conditions require a postback event, parameter and value');
      }
      postback = { key: rule.postback.key, value: rule.postback.value };
      if (postback.key === 'cusa_mfa') invalid('cusa_mfa is reserved for the protected CUSA SSO route');
    }
    ruleIds.add(rule.id);
    return { id: rule.id, name: rule.name, enabled: rule.enabled, eventType: rule.eventType, ...(postback ? { postback } : {}),
      ...(reject ? { action: 'reject' } : { appId: rule.appId }) };
  });
  return { version: 2, revision: input.revision, apps, rules, fallbackAppId: input.fallbackAppId };
}

function migrateRouting(input, config) {
  if (!object(input) || input.version !== 1 || !Array.isArray(input.apps) || !Array.isArray(input.rules)) {
    throw new RoutingValidationError('Invalid legacy routing');
  }
  const next = { ...input, version: 2, revision: randomUUID(), apps: input.apps.map(app => ({ ...app })) };
  // Only remove the shipped legacy MFA rule; never silently rewrite custom rules.
  next.rules = input.rules.filter(rule => !(rule.id === 'line-mfa' && rule.appId === 'sso'
    && rule.enabled === true && rule.eventType === 'postback' && rule.postback?.key === 'action' && rule.postback?.value === 'mfa'));
  const sso = next.apps.find(app => app.id === 'sso');
  if (sso && sso.url === 'https://sso.reunion.scicu-alumni.com/api/line/mfa') sso.url = config.ssoWebhookUrl;
  return validateRouting(next);
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
const MIGRATE = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[2], ARGV[1], 'NX')
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
`;

function createRoutingStore(redis, config) {
  const initial = JSON.stringify(validateRouting(defaultRouting(config)));
  return {
    async get() {
      const raw = await redis.eval(GET_OR_INITIALIZE, 1, ROUTING_KEY, initial);
      // Corrupt stored rules fail closed; never silently send to a default app.
      const current = JSON.parse(raw);
      if (current?.version === 1) {
        const next = migrateRouting(current, config);
        if (await redis.eval(MIGRATE, 2, ROUTING_KEY, ROUTING_BACKUP_KEY, raw, JSON.stringify(next)) === 1) return next;
        // One bounded reread after a concurrent migration/edit; never overwrite it.
        return validateRouting(JSON.parse(await redis.get(ROUTING_KEY)));
      }
      return validateRouting(current);
    },
    async save(input) {
      const normalized = validateRouting(input);
      if (normalized.apps.find(app => app.id === 'sso').url !== config.ssoWebhookUrl) {
        throw new RoutingValidationError('SSO URL must match SSO_WEBHOOK_URL on the server');
      }
      const next = { ...normalized, revision: randomUUID() };
      if (await redis.eval(SAVE, 1, ROUTING_KEY, normalized.revision, JSON.stringify(next)) !== 1) {
        throw new RoutingConflictError('Routing was changed by another administrator; reload before saving');
      }
      return next;
    }
  };
}

module.exports = { createRoutingStore, defaultRouting, validateRouting, migrateRouting, ROUTING_KEY, ROUTING_BACKUP_KEY, RoutingValidationError, RoutingConflictError };
