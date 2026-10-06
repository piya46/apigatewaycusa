'use strict';

const { createHmac, randomUUID } = require('node:crypto');
const { isMfa } = require('../public/admin/assets/line-contract');
const RECENT = Object.freeze({ index: 'webhook:recent:index', prefix: 'webhook:recent:item:', limit: 200, ttl: 86400 });
const ROUTING_KEYS = new Set(['action', 'app', 'route', 'intent', 'menu', 'command', 'service', 'module']);
const MESSAGE_TYPES = new Set(['text', 'image', 'video', 'audio', 'file', 'location', 'sticker']);
const fingerprint = (key, value, secret) => createHmac('sha256', secret).update(`recent:v1\0${key}\0${value}`).digest('hex');

function summarizeEvent(event, secret, now = Date.now()) {
  const sample = { id: randomUUID(), receivedAt: now,
    type: /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(event.type) ? event.type : 'unknown',
    redelivery: event.deliveryContext?.isRedelivery === true, protected: isMfa(event) };
  if (sample.protected) return sample; // No MFA parameter names, values, IDs or fingerprints.
  if (event.type === 'message' && MESSAGE_TYPES.has(event.message?.type)) sample.messageType = event.message.type;
  if (event.type === 'postback' && typeof event.postback?.data === 'string') {
    const params = new URLSearchParams(event.postback.data);
    const keys = [...new Set(params.keys())];
    sample.truncated = keys.length > 20;
    sample.keyVersion = fingerprint('key-version', '', secret);
    sample.parameters = keys.slice(0, 20).filter(key => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)).map(key => {
      const values = params.getAll(key);
      const ambiguous = values.length !== 1;
      const visible = !ambiguous && ROUTING_KEYS.has(key) && /^[a-z][a-z_-]{0,31}$/.test(values[0]);
      return { key, ambiguous, ...(ambiguous ? {} : { fingerprint: fingerprint(key, values[0], secret) }),
        ...(visible ? { value: values[0] } : { masked: true }) };
    });
    if (sample.parameters.length !== keys.length) sample.truncated = true;
  }
  return sample;
}

function currentRoute(sample, routing, secret) {
  if (sample.protected) return { kind: 'protected', appId: 'sso' };
  if (sample.type === 'unknown') return { kind: 'unknown' };
  for (const rule of routing.rules) {
    if (!rule.enabled || rule.eventType !== sample.type) continue;
    if (rule.postback) {
      if (sample.keyVersion && sample.keyVersion !== fingerprint('key-version', '', secret)) return { kind: 'unknown' };
      const param = sample.parameters?.find(item => item.key === rule.postback.key);
      if (!param) { if (sample.truncated) return { kind: 'unknown' }; continue; }
      if (param.ambiguous || param.fingerprint !== fingerprint(rule.postback.key, rule.postback.value, secret)) continue;
    }
    return rule.action === 'reject' ? { kind: 'reject', ruleId: rule.id }
      : { kind: 'forward', ruleId: rule.id, appId: rule.appId };
  }
  return routing.fallbackAppId === null ? { kind: 'reject', fallback: true }
    : { kind: 'forward', fallback: true, appId: routing.fallbackAppId };
}

function publicSample(sample, routing, secret) {
  const route = currentRoute(sample, routing, secret);
  const app = routing.apps.find(item => item.id === route.appId);
  const rule = routing.rules.find(item => item.id === route.ruleId);
  // Explicit allowlist; never return internal fingerprints or arbitrary stored fields.
  return { id: sample.id, receivedAt: sample.receivedAt, type: sample.type,
    protected: sample.protected === true, redelivery: sample.redelivery === true,
    ...(MESSAGE_TYPES.has(sample.messageType) ? { messageType: sample.messageType } : {}),
    parameters: (sample.parameters || []).map(item => ({ key: item.key, ambiguous: item.ambiguous === true,
      ...(ROUTING_KEYS.has(item.key) && /^[a-z][a-z_-]{0,31}$/.test(item.value || '') ? { value: item.value } : { masked: true }) })),
    truncated: sample.truncated === true, route: { ...route,
      ...(app ? { appName: app.name } : {}), ...(rule ? { ruleName: rule.name } : {}) } };
}

function createRecentEvents(redis, config) {
  return { async list(routing) {
    const ids = await redis.zrevrange(RECENT.index, 0, RECENT.limit - 1);
    if (!ids.length) return [];
    const entries = await redis.mget(...ids.map(id => RECENT.prefix + id));
    const now = Date.now();
    return entries.filter(Boolean).map(raw => JSON.parse(raw))
      .filter(sample => Number.isFinite(sample.receivedAt) && sample.receivedAt > now - RECENT.ttl * 1000)
      .map(sample => publicSample(sample, routing, config.lineChannelSecret));
  } };
}

module.exports = { RECENT, summarizeEvent, currentRoute, publicSample, createRecentEvents };
